/**
 * In-process realtime hub (CONTRACT shared by the media and chat modules).
 * Modules call `hub.publish(event, audience)`; the SSE endpoint (`GET /api/events`, owned by the
 * chat module) subscribes per patient or per clinician.
 */
import type { RealtimeEvent } from '../../shared/types/api';

export interface Audience {
  /** Deliver to this patient's app. */
  patientId?: string;
  /** Deliver to these clinicians' apps. */
  clinicianIds?: string[];
}

export interface Subscriber {
  patientId?: string;
  clinicianId?: string;
  send(event: RealtimeEvent): void;
}

export interface RealtimeHub {
  publish(event: RealtimeEvent, audience: Audience): void;
  /** Returns an unsubscribe function. */
  subscribe(sub: Subscriber): () => void;
  subscriberCount(): number;
}

export function createRealtimeHub(): RealtimeHub {
  const subs = new Set<Subscriber>();
  return {
    publish(event, audience) {
      for (const s of subs) {
        const forPatient = audience.patientId !== undefined && s.patientId === audience.patientId;
        const forClinician = s.clinicianId !== undefined && (audience.clinicianIds ?? []).includes(s.clinicianId);
        if (!forPatient && !forClinician) continue;
        try {
          s.send(event);
        } catch {
          subs.delete(s);
        }
      }
    },
    subscribe(sub) {
      subs.add(sub);
      return () => subs.delete(sub);
    },
    subscriberCount: () => subs.size,
  };
}
