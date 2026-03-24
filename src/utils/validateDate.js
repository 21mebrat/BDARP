function validateDate(dateStr) {
  if (!dateStr?.trim()) {
    return false;
  }

  // Regex for YYYY-MM-DD format
  const dateRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;

  if (!dateRegex.test(dateStr)) {
    return false;
  }

  const [year, month, day] = dateStr.split("-").map(Number);

  // Additional validation for actual date validity
  const dateObj = new Date(year, month - 1, day);

  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() + 1 !== month ||
    dateObj.getDate() !== day
  ) {
    return false; // Invalid date (e.g., February 30th)
  }

  return true;
}

module.exports = { validateDate };
