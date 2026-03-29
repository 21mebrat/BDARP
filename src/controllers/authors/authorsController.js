import { StatusCodes } from "http-status-codes";
import { getClient } from "../db/db.js";
import { rMessage } from "../utils/responseMessages.js";
import { validate as isValiduuid } from "uuid";
import fs from "fs/promises";
import path from "path";

import { generateSlug, isValidSlug } from "../../utils/slugGenerator.js";
import { validateAndSaveFile } from "../../utils/saveFiles.js";
const ALLOWED_FIELDS = new Set([
  "name",
  "bio",
  "birth_date",
  "death_date",
  "nationality",
  "website_url",
  "photo_url",
]);

const LIMITS = {
  name_max: 200,
  bio_max: 5000,
  nationality_max: 100,
};

const isValidString = (value) =>
  typeof value === "string" && value.trim().length > 0;

const parseUrl = (value) => {
  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
};

const removeMediaFile = async (name) => {
  if (name && typeof name === "string") {
    const filePath = path.join("./", "Media", "Authors", name);
    try {
      await fs.unlink(filePath).catch(() => {});
    } catch {}
  }
};

export const createAuthor = async (req, res) => {
  let client;

  try {
    // --- 1. Validate authenticated user ---
    const userId = req.user?.userId;

    if (!userId || !isValiduuid(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    // --- 2. Extract form fields and files ---
    const fields = req.formFields ?? {};
    const files = req.formFiles ?? {};

    // --- 3. Check unknown fields ---
    const unknownFields = Object.keys(fields).filter(
      (f) => !ALLOWED_FIELDS.has(f),
    );

    if (unknownFields.length) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.unknown_fields,
        data: null,
      });
    }

    // --- 4. Validate and save photo ---
    let photo_url = null;
    if ("photo_url" in files) {
      const file = files.photo_url;
      if (!file) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.author_photo_invalid,
          data: null,
        });
      }
      try {
        photo_url = await validateAndSaveFile(file, {
          folder: "UserProfile",
          allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
          maxSizeMB: 5,
        });
      } catch (uploadError) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.author_photo_invalid,
          data: null,
        });
      }
    }

    // --- 5. Extract and validate fields ---
    let {
      name,
      bio = null,
      birth_date = null,
      death_date = null,
      nationality = null,
      website_url = null,
    } = fields;

    if (!isValidString(name) || name.trim().length > LIMITS.name_max) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.author_name_invalid,
        data: null,
      });
    }
    name = name.trim();

    if (bio && (!isValidString(bio) || bio.length > LIMITS.bio_max)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.author_bio_invalid,
        data: null,
      });
    }

    if (
      nationality &&
      (!isValidString(nationality) ||
        nationality.trim().length > LIMITS.nationality_max)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.author_nationality_invalid,
        data: null,
      });
    }

    // --- 6. Validate birth_date ---
    if (birth_date) {
      const birth = new Date(birth_date);
      if (birth > new Date()) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.author_birth_future,
          data: null,
        });
      }
      birth_date = birth;
    }

    // --- 7. Validate death_date ---
    if (death_date) {
      const death = new Date(death_date);
      if (birth_date && death <= birth_date) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.author_death_before_birth,
          data: null,
        });
      }
      death_date = death;
    }

    // --- 8. Validate website_url ---
    if (website_url) {
      const parsed = parseUrl(website_url);
      if (!parsed) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.invalid_url,
          data: null,
        });
      }
      website_url = parsed;
    }

    // --- 9. Generate slug ---
    const slug = generateSlug(name);

    // --- 10. DB Operations ---
    client = await getClient();
    await client.query("BEGIN");

    // Check if author already exists
    const { rows: existing } = await client.query(
      `SELECT id FROM authors WHERE slug = $1 LIMIT 1`,
      [slug],
    );

    if (existing.length) {
      await client.query("ROLLBACK");
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: rMessage.author_already_exists,
        data: null,
      });
    }

    // Insert new author
    const { rows } = await client.query(
      `INSERT INTO authors
        (name, slug, bio, birth_date, death_date, nationality, website_url, created_by, photo_url)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, slug`,
      [
        name,
        slug,
        bio,
        birth_date,
        death_date,
        nationality,
        website_url,
        userId,
        photo_url,
      ],
    );

    await client.query("COMMIT");

    // --- 11. Success response ---
    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: rMessage.author_created_success,
      data: rows[0],
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("createAuthor error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.internal_server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const getAuthor = async (req, res) => {
  let client;

  try {
    // validate authentication
    const userId = req.user?.userId;

    if (!userId || !isValiduuid(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    const slug = req.params?.slug?.trim();

    // validate slug
    if (!slug || !isValidSlug(slug)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    client = await getClient();

    const { rows } = await client.query(
      `SELECT
        id,
        name,
        slug,
        bio,
        photo_url,
        birth_date,
        death_date,
        nationality,
        website_url,
        created_at
      FROM authors
      WHERE slug = $1
      LIMIT 1`,
      [slug],
    );

    if (!rows.length) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.author_not_found,
        data: null,
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.author_retrieved_successfully,
      data: rows[0],
    });
  } catch (_) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.internal_server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const listAuthors = async (req, res) => {
  let client;
  const empty = () => {
    return {
      success: true,
      message: null,
      data: [],
      page: 1,
      total: 0,
      totalPages: 0,
    };
  };

  try {
    // --- 1. Validate authenticated user ---
    const userId = req.user?.userId;

    if (!userId || !isValiduuid(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    // --- 2. Extract query params ---
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    let sort = parseInt(req.query.sort) || -1;
    let search = req.query.search?.trim() || null;

    // --- 3. Validate query params ---
    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    if (![-1, 1].includes(sort)) sort = -1;

    const offset = (page - 1) * limit;

    // --- 4. Get DB client ---
    client = await getClient();

    // --- 5. Construct query ---
    let baseQuery = `
      FROM authors
    `;
    const values = [];

    if (search) {
      baseQuery += ` WHERE name ILIKE $1`;
      values.push(`%${search}%`);
    }

    // --- 6. Get total count for pagination metadata ---
    const countQuery = `SELECT COUNT(*) ${baseQuery}`;
    const totalResult = await client.query(countQuery, values);
    const total = parseInt(totalResult.rows[0].count);

    // --- 7. Add ORDER, LIMIT, OFFSET ---
    const dataQuery = `
      SELECT id, name, slug, nationality, birth_date
      ${baseQuery}
      ORDER BY created_at ${sort === 1 ? "ASC" : "DESC"}
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
    `;
    values.push(limit, offset);

    const { rows } = await client.query(dataQuery, values);

    // --- 8. Send professional response ---
    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.authors_list_retrieved,
      data: rows,
      page,
      total,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("listAuthors error:", error);
    return empty();
  } finally {
    if (client) client.release();
  }
};

export const updateAuthor = async (req, res) => {
  let client;

  try {
    // --- 1. Validate authenticated user ---
    const userId = req.user?.userId;
    if (!userId || !isValiduuid(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    // --- 2. Validate slug ---
    const slug = req.params?.slug;
    if (!slug || !isValidSlug(slug)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    // --- 3. Extract fields and files ---
    const fields = req.formFields ?? {};
    const files = req.formFiles ?? {};

    // --- 4. Validate update fields ---
    const unknownFields = Object.keys(fields).filter(
      (f) => !ALLOWED_FIELDS.has(f),
    );
    if (unknownFields.length) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.unknown_update_fields,
        data: null,
      });
    }

    // --- 5. Validate photo if exists ---
    let newPhotoUrl = null;
    if ("photo_url" in files) {
      const file = files.photo_url;
      if (!file) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.author_photo_invalid,
          data: null,
        });
      }
      try {
        newPhotoUrl = await validateAndSaveFile(file, {
          folder: "UserProfile",
          allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
          maxSizeMB: 5,
        });
      } catch (uploadError) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.author_photo_invalid,
          data: null,
        });
      }
    }

    if (Object.keys(fields).length === 0 && !newPhotoUrl) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.no_update_fields,
        data: null,
      });
    }

    // --- 6. Prepare dynamic SET query ---
    const updates = [];
    const values = [];
    let index = 1;

    for (const [key, value] of Object.entries(fields)) {
      if (["id", "slug", "created_by", "created_at"].includes(key)) continue;
      const trimmedValue = typeof value === "string" ? value.trim() : value;
      updates.push(`${key} = $${index}`);
      values.push(trimmedValue);
      index++;
    }

    if (newPhotoUrl) {
      updates.push(`photo_url = $${index}`);
      values.push(newPhotoUrl);
      index++;
    }

    client = await getClient();
    await client.query("BEGIN");

    // --- 7. Fetch existing author (to delete old photo if needed) ---
    const { rows: existingRows } = await client.query(
      `SELECT photo_url FROM authors WHERE slug = $1 LIMIT 1`,
      [slug],
    );

    if (!existingRows.length) {
      await client.query("ROLLBACK");
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.author_not_found,
        data: null,
      });
    }

    const oldPhotoUrl = existingRows[0].photo_url;

    // --- 8. Execute update ---
    const query = `
      UPDATE authors
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE slug = $${index}
      RETURNING id, name, slug, photo_url
    `;
    values.push(slug);

    const { rows } = await client.query(query, values);
    await client.query("COMMIT");

    // --- 9. Remove old photo from server if a new one was uploaded ---
    if (newPhotoUrl && oldPhotoUrl && oldPhotoUrl !== newPhotoUrl) {
      try {
        await removeMediaFile(oldPhotoUrl);
      } catch (err) {
        console.warn("Failed to delete old author photo:", err);
      }
    }

    // --- 10. Success response ---
    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.author_updated_success,
      data: rows[0],
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("updateAuthor error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.internal_server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const deleteAuthor = async (req, res) => {
  let client;

  try {
    // --- 1. Validate authenticated user ---
    const userId = req.user?.userId;
    if (!userId || !isValiduuid(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    // --- 2. Validate slug ---
    const slug = req.params?.slug?.trim();
    if (!slug || !isValidSlug(slug)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    client = await getClient();
    await client.query("BEGIN");

    // --- 3. Fetch existing author ---
    const { rows: existingRows } = await client.query(
      `SELECT id, photo_url FROM authors WHERE slug = $1 LIMIT 1`,
      [slug],
    );

    if (!existingRows.length) {
      await client.query("ROLLBACK");
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.author_not_found,
        data: null,
      });
    }

    const { id, photo_url } = existingRows[0];

    // --- 4. Delete author ---
    const { rowCount } = await client.query(
      `DELETE FROM authors WHERE id = $1`,
      [id],
    );

    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.author_not_found,
        data: null,
      });
    }

    await client.query("COMMIT");

    // --- 5. Remove author photo if exists ---
    if (photo_url) {
      try {
        await deleteFile(photo_url);
      } catch (err) {
        console.warn("Failed to delete author photo:", err);
      }
    }

    // --- 6. Success response ---
    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.author_deleted_success,
      data: null,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("deleteAuthor error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.internal_server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};
