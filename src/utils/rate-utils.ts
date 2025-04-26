type RateFormat = {
  value: number;
  unit: "/sec" | "/min" | "/hour" | "/day";
  formatted: string;
};

/**
 * Formats a rate (given in amount per second) into a human-readable format
 * like per minute, per hour, or per day, depending on thresholds.
 */
export const formatRate = (ratePerSecond: number): RateFormat => {
  const ratePerMinute = ratePerSecond * 60;
  const ratePerHour = ratePerMinute * 60;
  const ratePerDay = ratePerHour * 24;

  if (ratePerSecond >= 1) {
    return {
      value: ratePerSecond,
      unit: "/sec",
      formatted: `${ratePerSecond.toFixed(2)} / sec`,
    };
  } else if (ratePerMinute >= 0.1) {
    return {
      value: ratePerMinute,
      unit: "/min",
      formatted: `${ratePerMinute.toFixed(2)} / min`,
    };
  } else if (ratePerHour >= 1) {
    return {
      value: ratePerHour,
      unit: "/hour",
      formatted: `${ratePerHour.toFixed(2)} / hour`,
    };
  } else {
    return {
      value: ratePerDay,
      unit: "/day",
      formatted: `${ratePerDay.toFixed(2)} / day`,
    };
  }
};
