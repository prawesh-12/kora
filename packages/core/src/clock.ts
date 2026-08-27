let testClock: Date | null = null;

export function now(): Date {
  return testClock ? new Date(testClock.getTime()) : new Date();
}

export function setTestClock(d: Date | null): void {
  testClock = d;
}
