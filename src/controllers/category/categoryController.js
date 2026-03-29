import { StatusCodes } from "http-status-codes";
import { getClient } from "../db/db.js";
import { validate as uuidValidate } from "uuid";
import { rMessage } from "../../utils/responseMessages.js";
import { isValidSlug } from "../../utils/slugGenerator.js";

const hexRegex = /^#[0-9A-Fa-f]{6}$/;

const validateColor = (color) => {
  if (!color) return true;
  return hexRegex.test(color);
};

const isValidString = (value) =>
  typeof value === "string" && value.trim().length > 0;

export const createCategory = async (req, res) => {
  let client;
  try {
    const userId = req.user?.userId;
    if (!userId || !uuidValidate(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    const { name, parent_id, color_hex, sort_order, icon_url, description } =
      req?.body ?? {};

    // ── 1. Validate required fields ─────────────────────────────
    if (!name || !isValidString(name)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_name_required,
        data: null,
      });
    }

    if (name.length > 120) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_name_length,
        data: null,
      });
    }

    if (!icon_url && !isValidString(icon_url)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_icon_invalid,
        data: null,
      });
    }
    if (description && !isValidString(description)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_description_invalid,
        data: null,
      });
    }
    // Use slug if provided, else generate from name
    let slug = generateSlug(name);

    if (isValidSlug(slug)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_slug_length,
        data: null,
      });
    }

    if (color_hex && !validateColor(color_hex)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_color_invalid,
        data: null,
      });
    }

    if (parent_id && !uuidValidate(parent_id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_parent_invalid,
        data: null,
      });
    }

    client = await getClient();
    await client.query("BEGIN");

    // ── 2. Check duplicates ─────────────────────────────
    const { rows: duplicates } = await client.query(
      `SELECT id, name, slug FROM categories WHERE name = $1 OR slug = $2 LIMIT 1`,
      [name.trim(), slug],
    );

    if (duplicates.length > 0) {
      await client.query("ROLLBACK");
      const dup = duplicates[0];
      if (dup.name === name.trim()) {
        return res.status(StatusCodes.CONFLICT).json({
          success: false,
          message: rMessage.category_name_exists,
          data: null,
        });
      }
      if (dup.slug === slug) {
        return res.status(StatusCodes.CONFLICT).json({
          success: false,
          message: rMessage.category_slug_exists,
          data: null,
        });
      }
    }

    // ── 3. Validate parent category exists ─────────────
    if (parent_id) {
      const { rowCount: parentExists } = await client.query(
        `SELECT id FROM categories WHERE id = $1 LIMIT 1`,
        [parent_id],
      );

      if (parentExists === 0) {
        await client.query("ROLLBACK");
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.category_parent_invalid,
          data: null,
        });
      }
    }

    // ── 4. Insert category ─────────────────────────────
    const { rows: inserted } = await client.query(
      `INSERT INTO categories
       (name, slug, parent_id, color_hex, sort_order, icon_url, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        name.trim(),
        slug,
        parent_id || null,
        color_hex || null,
        sort_order ?? 0,
        icon_url || null,
        description || null,
      ],
    );

    await client.query("COMMIT");

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: rMessage.category_created_success,
      data: inserted[0],
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});

    console.error("createCategory error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const updateCategory = async (req, res) => {
  let client;

  try {
    const userId = req.user?.userId;
    if (!userId || !uuidValidate(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    const categoryId = req.params?.id;
    if (!categoryId || !uuidValidate(categoryId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    const { name, parent_id, color_hex, sort_order, icon_url, description } =
      req?.body ?? {};

    const updates = {};
    const errors = {};

    // ── 1. Validate fields ─────────────────────────────
    if (name !== undefined) {
      if (!isValidString(name)) {
        errors.name = rMessage.category_name_required;
      } else if (name.trim().length > 120) {
        errors.name = rMessage.category_name_length;
      } else {
        updates.name = name.trim();
        // regenerate slug from updated name
        const newSlug = generateSlug(name.trim());
        if (!isValidSlug(newSlug)) {
          errors.slug = rMessage.category_slug_length;
        } else {
          updates.slug = newSlug;
        }
      }
    }

    if (color_hex !== undefined) {
      if (color_hex && !validateColor(color_hex)) {
        errors.color_hex = rMessage.category_color_invalid;
      } else {
        updates.color_hex = color_hex || null;
      }
    }

    if (sort_order !== undefined) {
      updates.sort_order = Number(sort_order) || 0;
    }

    if (icon_url !== undefined) {
      if (!isValidString(icon_url)) {
        errors.icon_url = rMessage.category_icon_invalid;
      } else {
        updates.icon_url = icon_url.trim();
      }
    }

    if (description !== undefined) {
      if (description && !isValidString(description)) {
        errors.description = rMessage.category_description_invalid;
      } else {
        updates.description = description.trim() || null;
      }
    }

    if (parent_id !== undefined) {
      if (parent_id && !uuidValidate(parent_id)) {
        errors.parent_id = rMessage.category_parent_invalid;
      } else if (parent_id === categoryId) {
        errors.parent_id = rMessage.category_parent_invalid;
      } else {
        updates.parent_id = parent_id || null;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.invalid_request,
        meta: errors,
        data: null,
      });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.no_update_fields,
        data: null,
      });
    }

    client = await getClient();
    await client.query("BEGIN");

    // ── 2. Check category exists ─────────────────────────────
    const { rowCount: exists } = await client.query(
      `SELECT id FROM categories WHERE id = $1 LIMIT 1`,
      [categoryId],
    );

    if (exists === 0) {
      await client.query("ROLLBACK");
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.category_not_found,
        data: null,
      });
    }

    // ── 3. Check duplicate name ─────────────────────────────
    if (updates.name) {
      const { rowCount: nameDup } = await client.query(
        `SELECT id FROM categories WHERE name = $1 AND id != $2 LIMIT 1`,
        [updates.name, categoryId],
      );

      if (nameDup > 0) {
        await client.query("ROLLBACK");
        return res.status(StatusCodes.CONFLICT).json({
          success: false,
          message: rMessage.category_name_exists,
          data: null,
        });
      }
    }

    // ── 4. Check duplicate slug ─────────────────────────────
    if (updates.slug) {
      const { rowCount: slugDup } = await client.query(
        `SELECT id FROM categories WHERE slug = $1 AND id != $2 LIMIT 1`,
        [updates.slug, categoryId],
      );

      if (slugDup > 0) {
        await client.query("ROLLBACK");
        return res.status(StatusCodes.CONFLICT).json({
          success: false,
          message: rMessage.category_slug_exists,
          data: null,
        });
      }
    }

    // ── 5. Validate parent exists ─────────────────────────────
    if (updates.parent_id) {
      const { rowCount: parentExists } = await client.query(
        `SELECT id FROM categories WHERE id = $1 LIMIT 1`,
        [updates.parent_id],
      );

      if (parentExists === 0) {
        await client.query("ROLLBACK");
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: rMessage.category_parent_invalid,
          data: null,
        });
      }
    }

    // ── 6. Build query dynamically ─────────────────────────────
    const setClauses = [];
    const values = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }

    setClauses.push(`updated_at = NOW()`);
    const queryText = `
      UPDATE categories
      SET ${setClauses.join(", ")}
      WHERE id = $${idx}
      RETURNING *
    `;
    values.push(categoryId);

    const { rows: updatedRows } = await client.query(queryText, values);
    await client.query("COMMIT");

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.category_updated_success,
      data: updatedRows[0],
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("updateCategory error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const getCategories = async (req, res) => {
  let client;

  try {
    const userId = req.user?.userId;
    if (!userId || !uuidValidate(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }
    client = await getClient();

    // --- 2. Extract query params ---
    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    let sort = parseInt(req.query.sort) || -1;
    let search = req.query.search?.trim() || null;
    let parent_id = req.query.parent_id?.trim() || null;

    // --- 3. Validate query params ---
    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    if (![-1, 1].includes(sort)) sort = -1;

    const offset = (page - 1) * limit;

    const filters = [];
    const values = [];
    let idx = 1;

    // Optional search filter
    if (search && isValidString(search)) {
      filters.push(`name ILIKE $${idx}`);
      values.push(`%${search.trim()}%`);
      idx++;
    }
    // Optional search filter
    if (parent_id && isValidString(parent_id)) {
      filters.push(`parent_id = $${idx}`);
      values.push(parent_id);
      idx++;
    }

    const whereClause =
      filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

    // Total count for pagination
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) AS total FROM categories ${whereClause}`,
      values,
    );
    const total = Number(countRows[0].total);

    // Fetch paginated categories
    const { rows } = await client.query(
      `
      SELECT id, name, slug, parent_id, color_hex, sort_order, icon_url, description, created_at, updated_at
      FROM categories
      ${whereClause}
      ORDER BY sort_order ASC, name ASC
      LIMIT $${idx} OFFSET $${idx + 1}
      `,
      [...values, limitNum, offset],
    );

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.success,
      data: {
        categories: rows,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error("getCategories error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const getCategory = async (req, res) => {
  let client;

  try {
    const userId = req.user?.userId;
    if (!userId || !uuidValidate(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }
    const slug = req.params?.slug;

    if (!isValidSlug(slug)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: rMessage.category_not_found,
        data: null,
      });
    }
    client = await getClient();

    const { rows } = await client.query(
      `SELECT id, name, slug, parent_id, color_hex, sort_order, icon_url, description, created_at, updated_at
       FROM categories
       WHERE slug = $1
       LIMIT 1`,
      [slug],
    );

    if (rows.length === 0) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.category_not_found,
        data: null,
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.success,
      data: rows[0],
    });
  } catch (error) {
    console.error("getCategory error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};

export const deleteCategory = async (req, res) => {
  let client;

  try {
    const userId = req.user?.userId;
    if (!userId || !uuidValidate(userId)) {
      return res.status(StatusCodes.NOT_ACCEPTABLE).json({
        success: false,
        message: rMessage.invalid_request,
        data: null,
      });
    }

    const slug = req.params?.slug;

    if (!isValidSlug(slug))
      return res.status(StatusCodes.BAD_REQUEST).json({
        message: rMessage.category_not_found,
      });
    client = await getClient();

    const result = await client.query(
      `DELETE FROM categories WHERE id=$1 RETURNING id`,
      [id],
    );

    if (result.rowCount === 0) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: rMessage.category_not_found,
        data: null,
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: rMessage.category_deleted_success,
      data: null,
    });
  } catch (error) {
    console.error("deleteCategory error:", error);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: rMessage.server_error,
      data: null,
    });
  } finally {
    if (client) client.release();
  }
};
