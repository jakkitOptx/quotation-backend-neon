const THAILAND_UTC_OFFSET_MINUTES = 7 * 60;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeScopedName = (value = "") =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const parseDateOnly = (value) => {
  if (!DATE_ONLY_REGEX.test(String(value || ""))) {
    return null;
  }

  const [year, month, day] = String(value).split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
};

const createThailandDate = (year, month, day, hour = 0, minute = 0, second = 0, ms = 0) =>
  new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, ms) -
      THAILAND_UTC_OFFSET_MINUTES * 60 * 1000
  );

const addDays = ({ year, month, day }, amount) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + amount);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const parseDateRange = (from, to) => {
  const fromParts = parseDateOnly(from);
  const toParts = parseDateOnly(to);

  if (!fromParts || !toParts) {
    return null;
  }

  const start = createThailandDate(
    fromParts.year,
    fromParts.month,
    fromParts.day,
    0,
    0,
    0,
    0
  );
  const endExclusiveParts = addDays(toParts, 1);
  const endExclusive = createThailandDate(
    endExclusiveParts.year,
    endExclusiveParts.month,
    endExclusiveParts.day,
    0,
    0,
    0,
    0
  );

  if (start >= endExclusive) {
    return null;
  }

  return {
    from: `${fromParts.year.toString().padStart(4, "0")}-${String(fromParts.month).padStart(
      2,
      "0"
    )}-${String(fromParts.day).padStart(2, "0")}`,
    to: `${toParts.year.toString().padStart(4, "0")}-${String(toParts.month).padStart(
      2,
      "0"
    )}-${String(toParts.day).padStart(2, "0")}`,
    start,
    endExclusive,
  };
};

const parseWorkDate = (value) => {
  const parts = parseDateOnly(value);
  if (!parts) {
    return null;
  }

  return createThailandDate(parts.year, parts.month, parts.day, 0, 0, 0, 0);
};

const formatWorkDate = (value) => {
  const date = new Date(value);
  const thailandTime = new Date(date.getTime() + THAILAND_UTC_OFFSET_MINUTES * 60 * 1000);

  return `${thailandTime.getUTCFullYear().toString().padStart(4, "0")}-${String(
    thailandTime.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(thailandTime.getUTCDate()).padStart(2, "0")}`;
};

module.exports = {
  normalizeScopedName,
  parseDateRange,
  parseWorkDate,
  formatWorkDate,
};
