// The dashboard shows dates in the timezone saved in the account settings.
// It is module state (not React state) so plain date helpers can read it; it is
// updated before the data that depends on it is put into React state.

const DEFAULT_TIMEZONE = 'Europe/Berlin'

let currentTimezone = DEFAULT_TIMEZONE

const timezoneLabels: Record<string, string> = {
  'Europe/Berlin': '柏林',
  'Asia/Shanghai': '上海',
}

function isSupportedTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export function appTimezone() {
  return currentTimezone
}

export function setAppTimezone(timezone: string | null | undefined) {
  currentTimezone = timezone && isSupportedTimezone(timezone) ? timezone : DEFAULT_TIMEZONE
}

export function timezoneLabel(timezone = currentTimezone) {
  return timezoneLabels[timezone] ?? timezone
}
