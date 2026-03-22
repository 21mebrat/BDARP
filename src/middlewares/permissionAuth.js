import { StatusCodes } from "http-status-codes";
import { getClient } from "../db/db.js"; // PostgreSQL helper
import { rMessage } from "../utils/responseMessages.js";

export const fullPermission = (...permissions) => {
  return async (req, res, next) => {
    const skipRoutes = [
      "/abugida_api/user_api/login",
      "/abugida_api/user_api/forget_password",
      "/abugida_api/user_api/reset_password",
      "/abugida_api/user_api/change_pwd",
    ];

    if (skipRoutes.includes(req.path)) return next();

    const userId = req.user?.userId;
    if (!userId) {
      return res
        .status(StatusCodes.FORBIDDEN)
        .json({ message: rMessage.not_authorized });
    }

    let client;
    try {
      client = await getClient();

      // Fetch all permission names for the user via roles
      const result = await client.query(
        `
        SELECT p.action
        FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        JOIN user_roles ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = $1
        `,
        [userId],
      );

      if (result.rowCount === 0) {
        return res.status(StatusCodes.FORBIDDEN).json({
          message: rMessage.not_authorized,
        });
      }

      const userPermissions = result.rows.map((r) => r.action);

      if (
        !userPermissions ||
        !Array?.isArray(userPermissions) ||
        !userPermissions?.length
      ) {
        return res.status(StatusCodes.FORBIDDEN).json({
          message: rMessage.access_denied,
        });
      }

      // Check if the user has **all** required permissions
      const hasAllPermissions = permissions.every((p) =>
        userPermissions.includes(p),
      );

      if (!hasAllPermissions) {
        return res.status(StatusCodes.FORBIDDEN).json({
          message: rMessage.access_denied,
        });
      }

      next();
    } catch (error) {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        message: rMessage.access_denied,
      });
    } finally {
      if (client) client.release();
    }
  };
};

export const halfPermission = (...permissions) => {
  return async (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res
        .status(StatusCodes.FORBIDDEN)
        .json({ message: rMessage.not_authorized });
    }

    let client;
    try {
      client = await getClient();

      const result = await client.query(
        `
        SELECT p.action
        FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id
        JOIN user_roles ur ON ur.role_id = rp.role_id
        WHERE ur.user_id = $1
        `,
        [userId],
      );

      const userPermissions = result.rows.map((r) => r.action);

      if (
        !userPermissions ||
        !Array?.isArray(userPermissions) ||
        !userPermissions?.length
      ) {
        return res.status(StatusCodes.FORBIDDEN).json({
          message: rMessage.access_denied,
        });
      }

      // Check if the user has **at least one** permission
      const hasAnyPermission = permissions.some((p) =>
        userPermissions.includes(p),
      );

      if (!hasAnyPermission) {
        return res.status(StatusCodes.FORBIDDEN).json({
          message: rMessage.access_denied,
        });
      }

      next();
    } catch (error) {
      return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        message: rMessage.access_denied,
      });
    } finally {
      if (client) client.release();
    }
  };
};
