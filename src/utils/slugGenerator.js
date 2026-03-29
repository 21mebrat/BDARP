import slugify from "slugify";
import crypto from "crypto";

export const generateSlug = (name) => {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Invalid slug source: 'name' must be a non-empty string.");
  }
  const sanitizedName = name.trim();

  const baseSlug = slugify(sanitizedName, {
    lower: true,
    strict: true,
    trim: true,
    replacement: "-",
    remove: /[*+~.()'"!:@]/g,
  }).slice(0, 100);

  const randomSuffix = crypto.randomBytes(4).toString("hex");

  return `${baseSlug}-${randomSuffix}`;
};

export const isValidSlug = (slug) => {
  if (typeof slug !== "string") return false;

  const sanitized = slug.trim();

  if (!sanitized) return false;

  if (sanitized.length > 100) return false;

  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  return slugRegex.test(sanitized);
};
