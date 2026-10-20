/** Labels of a session, in the server's language (client.lua `WithLabels`, locales/*.json). */
export interface SessionLabels {
  confirm: string;
  cancel: string;
  clickPoint: string;
  minPoints: string;
  reference: string;
}

/** English labels when a session comes without them. */
export const DEFAULT_LABELS: SessionLabels = {
  confirm: 'Confirm',
  cancel: 'Cancel',
  clickPoint: 'Click a point',
  minPoints: 'The zone needs at least 3 points',
  reference: 'reference',
};

/** The labels of a session, English for any missing one. */
export const sessionLabels = (labels?: Partial<SessionLabels>): SessionLabels => ({ ...DEFAULT_LABELS, ...labels });
