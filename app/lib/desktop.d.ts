import type { ShipmentWatch } from './shipments';

declare global {
  interface Window {
    thorTrackDesktop?: {
      setWatch(watch: ShipmentWatch | null): Promise<void>;
      minimize(): Promise<void>;
      quit(): Promise<void>;
      onRefreshRequested(callback: () => void): () => void;
    };
  }
}

export {};
