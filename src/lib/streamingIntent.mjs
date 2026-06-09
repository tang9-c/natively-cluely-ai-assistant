export function shouldFlushPreviousStream(activeIntent, incomingIntent, activeMsgId) {
  if (!activeMsgId) return false;
  if (activeIntent == null) return false;
  return activeIntent !== incomingIntent;
}
