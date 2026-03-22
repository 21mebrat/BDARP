import { StatusCodes } from "http-status-codes";
import { getClient } from "../db/db.js";
import { rMessage } from "../utils/responseMessages.js";

export const roleAuth = (...roles) => {
  return async (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(StatusCodes.FORBIDDEN).json({
        message: rMessage.not_authorized,
      });
    }

    let client;
    try {
      client = await getClient();

      // Fetch the user roles from user_roles + roles table
      const result = await client.query(
        `
        SELECT r.name
        FROM roles r
        JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = $1
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
        `,
        [userId],
      );

      const userRoles = result.rows.map((r) => r.name);

      if (!userRoles || !Array?.isArray(userRoles) || !userRoles?.length) {
        return res.status(StatusCodes.FORBIDDEN).json({
          message: rMessage.access_denied,
        });
      }

      // Check if the user has at least one required role
      const hasRole = roles.some((role) => userRoles.includes(role));

      if (!hasRole) {
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
