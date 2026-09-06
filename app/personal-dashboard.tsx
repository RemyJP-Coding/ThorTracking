'use client';

import { useState } from 'react';
import { assessShippingForecast, evaluateWatch, forecastUnavailableCopy, shortModelDisplay, type ShipmentWatch } from './lib/shipments';
import { compareShipments, publishedEndpoint, type ConfigurationChange, type RangeObservation } from './lib/shipment-comparison';
import { displayedConfidence, sourceLabel, statusLabel, type ExperienceVisit, type Observation } from './lib/experience';

function date(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
}
function instant(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
const number = (value: number | null) => value === null ? 'Not available' : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const masked = (value: number | null) => value === null ? 'Waiting for data' : `${value}xx`;
const range = (item: RangeObservation) => `${item.startPrefix}xx–${item.endPrefix}xx`;

function ChangeDetails({ change }: { change: ConfigurationChange }) {
  const delta = change.currentEndpoint !== null && change.previousEndpoint !== null ? change.currentEndpoint - change.previousEndpoint : null;
  return <div className="change-details">
    {change.published.length ? <><p className="font-bold">Newly published dates</p><ul>{change.published.map((item) =>
      <li key={`${item.date}:${item.startPrefix}:${item.endPrefix}`}>{date(item.date)} · <span className="font-mono">{range(item)}</span></li>)}</ul></> : null}
    {delta !== null && delta !== 0 ? <p>{delta < 0
      ? `Revision: the highest published endpoint is ${Math.abs(delta)} prefix steps lower (${masked(change.previousEndpoint)} → ${masked(change.currentEndpoint)}). This is not forward progress.`
      : `Highest published endpoint: ${masked(change.previousEndpoint)} → ${masked(change.currentEndpoint)} (+${delta} prefix steps). ${change.historical.length ? 'This comparison includes historical edits; older ranges are not new dispatch progress.' : ''}`}</p> : null}
    {change.previousEndpoint === null && change.currentEndpoint !== null ? <p>First observed endpoint: {masked(change.currentEndpoint)}.</p> : null}
    {change.currentEndpoint === null && change.previousEndpoint !== null ? <p>Revision: the previously recorded configuration ranges were removed. Waiting for published data.</p> : null}
    {change.historical.length ? <div className="historical-changes"><p className="font-bold">Historical archive changes</p>
      <p>These update earlier records and do not establish new dispatch progress.</p>
      <ul>{change.historical.map((item) => <li key={item.date}>
        {date(item.date)} · {item.kind === 'revised' ? 'Revised' : item.kind === 'added' ? 'Added historical ranges' : 'Removed historical ranges'}
        {item.removed.length ? `: ${item.removed.map(range).join(', ')}` : ''}
        {item.added.length ? `${item.removed.length ? ' → ' : ': '}${item.added.map(range).join(', ')}` : ''}
      </li>)}</ul></div> : null}
  </div>;
}

export function PersonalDashboard({ watch, observation, visit, today, checking, unableToCheck, persisted, onEdit, onClear }: {
  watch: ShipmentWatch; observation: Observation | null; visit: ExperienceVisit | null; today: string;
  checking: boolean; unableToCheck: boolean; persisted: boolean; onEdit: () => void; onClear: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const days = observation?.days ?? [];
  const assessment = assessShippingForecast(days, watch, today);
  const evidence = assessment.evidence;
  const status = evaluateWatch(days, watch);
  const endpoint = publishedEndpoint(days, watch);
  const initial = visit?.record.initialEndpoint ?? null;
  const baseline = visit?.baseline;
  const comparison = baseline && observation ? compareShipments(baseline.days, days, watch) : null;
  const history = [...(visit?.record.history ?? [])].reverse();
  const visibleHistory = showHistory ? history : history.slice(0, 5);
  const markers = [{ label: 'Initial recorded', value: initial }, { label: 'Current highest', value: endpoint }, { label: 'Your prefix', value: watch.prefix }];
  const values = markers.map((item) => item.value).filter((item): item is number => item !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const confidence = observation ? displayedConfidence(assessment, observation.source) : null;

  return <section aria-labelledby="personal-title" className="personal-dashboard">
    <div className="personal-heading">
      <div><p className="personal-eyebrow">Your order watch</p>
        <h1 id="personal-title">{watch.prefix}xx <span>· {watch.color} · {shortModelDisplay(watch.model)}</span></h1>
      </div>
      <div className="personal-actions"><button type="button" onClick={onEdit}>Edit order</button><button type="button" onClick={onClear}>Clear</button></div>
    </div>
    <div className="personal-status" role="status">
      <strong>{observation ? statusLabel(status.kind) : 'Waiting for shipment history'}</strong>
      {observation ? <p>{status.kind === 'listed' ? `Your prefix appears in ${masked(status.match.startPrefix)}–${masked(status.match.endPrefix)}, published ${date(status.date)}.`
        : status.kind === 'passed' ? 'AYN has posted later prefixes, but no matching range includes yours. Shipment is not confirmed.'
        : status.kind === 'watching' ? `${status.distance} prefix steps remain to your prefix.`
        : 'Your watch is saved. The endpoint baseline will begin when data for this exact configuration becomes available.'}</p> : <p>{checking ? 'Checking AYN for a settled shipment snapshot…' : 'Only bundled reference data is available. Personal history begins when live or saved observations are available.'}</p>}
      {observation ? <p className="personal-meta">Using {sourceLabel(observation.source)}{observation.archivedAt && observation.source !== 'live' ? ` · Last successful source check ${instant(observation.archivedAt)}` : observation.checkedAt ? ` · Checked ${instant(observation.checkedAt)}` : ''}</p> : null}
    </div>

    <div className="personal-columns">
      <section className="personal-card" aria-labelledby="progress-title">
        <h2 id="progress-title">Personal progress</h2>
        <p className="personal-meta">{visit ? `History on this device starts ${instant(visit.record.startedAt)}.` : 'Preparing history on this device…'}</p>
        {endpoint !== null ? <>
          <div className="prefix-scale" role="img" aria-label={`Prefix scale. Initial recorded endpoint ${masked(initial)}. Current highest published endpoint ${masked(endpoint)}. Your prefix ${masked(watch.prefix)}.`}>
            <div className="prefix-track" />
            {markers.map((marker, index) => marker.value !== null ? <span key={marker.label} className={`prefix-marker prefix-marker-${index}`} style={{ left: `${max === min ? 50 : 5 + ((marker.value - min) / (max - min)) * 90}%` }}><span>{index + 1}</span></span> : null)}
            <span className="scale-start">{masked(min)}</span><span className="scale-end">{masked(max)}</span>
          </div>
          <dl className="progress-labels">{markers.map((marker, index) => <div key={marker.label}><dt><span className={`marker-key marker-key-${index}`}>{index + 1}</span>{marker.label}</dt><dd>{masked(marker.value)}</dd></div>)}</dl>
          <p><strong>{Math.max(0, watch.prefix - endpoint)} prefix steps remaining.</strong> {status.kind === 'passed' ? 'The endpoint passed your prefix without a matching range.' : status.kind === 'listed' ? 'Your prefix is explicitly listed.' : ''}</p>
          <p>Last advance: <strong>{evidence.lastAdvanceDate ? date(evidence.lastAdvanceDate) : 'Not recorded'}</strong>.</p>
        </> : <p>Waiting for configuration data. Your initial endpoint will be recorded when it becomes available.</p>}
        {visit?.record.endpointRevision ? <p className="revision-note">Revision observed {instant(visit.record.endpointRevision.observedAt)}: the endpoint was lowered from {masked(visit.record.endpointRevision.from)} to {masked(visit.record.endpointRevision.to)}. This was not counted as forward progress.</p> : null}
        <p className="personal-meta">Prefix steps describe published order-number ranges, not a count of people ahead or a queue percentage.</p>
      </section>

      <section className="personal-card forecast-card" aria-labelledby="forecast-title">
        <h2 id="forecast-title">Estimated AYN dispatch window</h2>
        {observation && assessment.kind === 'available' ? <><p className="forecast-window"><time dateTime={assessment.forecast.windowStart}>{date(assessment.forecast.windowStart)}</time> – <time dateTime={assessment.forecast.windowEnd}>{date(assessment.forecast.windowEnd)}</time></p>
          <p className="font-bold">{confidence?.replace('-', ' ')} confidence</p></>
          : <><p className="font-bold">Estimate unavailable</p><p>{observation ? forecastUnavailableCopy(assessment.kind === 'unavailable' ? assessment.reason : 'no-data') : 'A live or saved shipment observation is needed before an estimate can be recorded.'}</p></>}
        <p>A seven-day estimate for appearing on AYN’s dashboard. This is not an AYN promise or a carrier delivery ETA.</p>
        <details><summary>How this estimate is calculated</summary>
          <dl className="evidence-list">
            <div><dt>Remaining prefix steps</dt><dd>{number(evidence.gap)}</dd></div>
            <div><dt>Observed pace / day</dt><dd>{number(evidence.ratePerDay)}{evidence.ratePerDay !== null ? ' prefix steps' : ''}</dd></div>
            <div><dt>Advancing intervals</dt><dd>{number(evidence.intervalCount)}</dd></div>
            <div><dt>Training span</dt><dd>{number(evidence.historySpanDays)}{evidence.historySpanDays !== null ? ' calendar days' : ''}</dd></div>
            <div><dt>Last advance</dt><dd>{evidence.lastAdvanceDate ? date(evidence.lastAdvanceDate) : 'Not available'}</dd></div>
            <div><dt>Latest dashboard date</dt><dd>{evidence.sourceDate ? date(evidence.sourceDate) : 'Not available'}</dd></div>
          </dl>
          <p>Uses only {watch.color} · {shortModelDisplay(watch.model)}, following its highest endpoint over time. The pace is the median of endpoint changes per calendar day across pairs of training observations. Training uses up to eight recent observations, or the last three when recent history is sparse.</p>
          <p>{confidence === 'very-low' ? 'Very low confidence reflects just one advancing interval.' : confidence === 'moderate' ? 'Moderate confidence reflects several advances over at least 14 days, a steadier observed pace and a projection within the measured history.' : 'Low confidence reflects limited, variable or older evidence, or a projection beyond the observed span or movement.'} Confidence describes the evidence, without a probability or accuracy claim.</p>
          {observation && observation.source !== 'live' ? <p>Live AYN data is unavailable. Confidence is capped at low for saved data; very low remains very low.</p> : null}
          <p>Last advance is the date the highest endpoint advanced, which may be earlier than the newest published row. Estimates stop after 28 days without a configuration advance, 45 days without a dashboard update, or a projection beyond 90 days.</p>
        </details>
      </section>
    </div>

    <section className="personal-card visit-summary" aria-labelledby="visit-title">
      <h2 id="visit-title">Since your last visit</h2>
      {checking ? <p role="status">Checking for new changes… The comparison stays anchored to your previous visit.</p> : unableToCheck ? <p role="status">Unable to check for new changes. Any comparison below uses saved observations; an unchanged archive does not confirm that AYN has no updates.</p> : null}
      {!baseline ? <p>Comparisons begin with your next visit. This visit establishes the first displayed baseline on this device.</p> : comparison ? <>
        {!comparison.changed ? <p>{!checking && !unableToCheck ? 'No changes since your last visit.' : 'No differences in the saved observations.'}</p> : <>
          <h3>{watch.color} · {shortModelDisplay(watch.model)}</h3>
          {comparison.watched ? <ChangeDetails change={comparison.watched} /> : <p>No range changes for your watched configuration.</p>}
          {comparison.previousStatus !== comparison.currentStatus ? <p className="font-bold">Status: {statusLabel(comparison.previousStatus)} → {statusLabel(comparison.currentStatus)}.</p> : null}
        </>}
        {comparison.others.length ? <details><summary>Other configuration updates ({comparison.others.length})</summary>{comparison.others.map((change) => <div className="other-change" key={`${change.color}:${change.model}`}><h3>{change.color} · {shortModelDisplay(change.model)}</h3><ChangeDetails change={change} /></div>)}</details> : null}
      </> : <p>Waiting for a settled observation to compare.</p>}
      <p className="personal-meta">A visit starts on page load, or after this page was hidden for at least 30 minutes. Refreshing data keeps this visit’s comparison visible.</p>
    </section>

    <section className="personal-card" aria-labelledby="history-title">
      <h2 id="history-title">Forecast history</h2>
      <p className="personal-meta">Assessments you actually saw on this device. The newest 50 meaningful changes are retained.</p>
      {visibleHistory.length ? <ol className="forecast-history">{visibleHistory.map((entry, index) => <li key={`${entry.displayedAt}:${index}`}>
        <p className="personal-meta"><time dateTime={entry.displayedAt}>{instant(entry.displayedAt)}</time> · {sourceLabel(entry.source)}</p>
        <p className="font-bold">{entry.assessment.kind === 'available' ? `${date(entry.assessment.forecast.windowStart)} – ${date(entry.assessment.forecast.windowEnd)} · ${entry.confidence?.replace('-', ' ')} confidence` : `Estimate unavailable · ${forecastUnavailableCopy(entry.assessment.reason)}`}</p>
        <p>{statusLabel(entry.status)}</p>
        {entry.changes.map((change) => <p key={change}>{change}</p>)}
      </li>)}</ol> : <p>{checking ? 'History begins after the current check finishes while this page is visible.' : 'No settled assessment has been recorded yet.'}</p>}
      {history.length > 5 ? <button type="button" className="history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Show recent history' : `Show history (${history.length})`}</button> : null}
      {!persisted ? <p className="revision-note" role="status">Browser storage is unavailable. Your watch and history are kept for this tab only.</p> : null}
    </section>
  </section>;
}
