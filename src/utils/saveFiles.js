const { readFile, writeFile, mkdir } = require("fs/promises");
const path = require("path");

function sanitizeFilename(name = "") {
  // Prevent path traversal and illegal separators
  const base = path.basename(String(name));
  return base.replace(/[\/\\]/g, "_").replace(/\s+/g, "_");
}

async function ensureFolder(folder) {
  const dirPath = path.join(process.cwd(), "Media", folder);
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function validateAndSaveFile(
  file,
  { folder, allowedMimeTypes, maxSizeMB },
) {
  if (!file || typeof file !== "object") {
    const e = new Error("FILE_VALIDATION_ERROR");
    throw e;
  }

  const isValidType = allowedMimeTypes?.includes(file?.mimetype);
  const isValidSize = Number(file?.size || 0) <= maxSizeMB * 1024 * 1024;

  if (!isValidType || !isValidSize) {
    const e = new Error("ALLOWED_FILE_TYPE_ERROR");
    throw e;
  }

  if (!file.filepath) {
    const e = new Error("FILE_VALIDATION_ERROR");
    throw e;
  }

  const bytes = await readFile(file.filepath);
  const buffer = Buffer.from(bytes);

  // const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const safeOriginal = sanitizeFilename(file.originalFilename || "file");

  const dirPath = await ensureFolder(folder);
  const savePath = path.join(dirPath, safeOriginal);

  await writeFile(savePath, buffer);

  return safeOriginal;
}

module.exports = { validateAndSaveFile };
