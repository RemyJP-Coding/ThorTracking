'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { localCalendarDate, type ShipmentWatch } from './shipments';
import { beginVisit, readExperience, recordDisplayed, visitVisibility, watchIdentity, writeExperience, type ExperienceVisit, type Observation } from './experience';

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

function experienceStore() {
  let state: { visit: ExperienceVisit | null; persisted: boolean } = { visit: null, persisted: true };
  let initialized = false;
  const listeners = new Set<() => void>();
  function publish(visit: ExperienceVisit | null, persisted = state.persisted) {
    state = { visit, persisted };
    listeners.forEach((listener) => listener());
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    select(watch: ShipmentWatch | null) {
      if (initialized && watchIdentity(state.visit?.record.watch ?? null) === watchIdentity(watch)) return;
      initialized = true;
      const record = readExperience(browserStorage(), state.visit?.record ?? null);
      let visit = watch ? beginVisit(watch, record, new Date().toISOString()) : null;
      if (visit) visit = visitVisibility(visit, document.visibilityState === 'visible', Date.now());
      publish(visit, writeExperience(browserStorage(), visit?.record ?? null, watch));
    },
    visibility() {
      if (!state.visit) return;
      const visit = visitVisibility(state.visit, document.visibilityState === 'visible', Date.now());
      if (visit !== state.visit) publish(visit);
    },
    display(watch: ShipmentWatch | null, observation: Observation | null, settled: boolean, today: string, owner: string) {
      if (!watch || !state.visit || owner !== watchIdentity(watch)) return;
      const visit = recordDisplayed(state.visit, observation, {
        watch, visible: document.visibilityState === 'visible', settled, now: new Date().toISOString(), today,
      });
      if (visit !== state.visit) publish(visit, writeExperience(browserStorage(), visit.record, watch));
    },
  };
}

const serverSnapshot = { visit: null, persisted: true };
export function useExperience(watch: ShipmentWatch | null, observation: Observation | null, settled: boolean, today: string, owner: string) {
  const [store] = useState(experienceStore);
  const state = useSyncExternalStore(store.subscribe, store.snapshot, () => serverSnapshot);
  // Selection captures the previous visit before the tracker's refresh effect starts.
  useEffect(() => { store.select(watch); }, [store, watch]);
  useEffect(() => {
    const visible = () => {
      store.visibility();
      store.display(watch, observation, settled, localCalendarDate(), owner);
    };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [store, watch, observation, settled, today, owner]);
  useEffect(() => { store.display(watch, observation, settled, today, owner); }, [store, watch, observation, settled, today, owner]);
  return state;
}
