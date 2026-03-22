import { Pool} from "pg";

/*
DATABASE CONFIGURATION
*/

const pool = new Pool({
  host: process?.env.DB_HOST,
  port: Number(process?.env.DB_PORT),
  user: process?.env.DB_USER,
  password: process?.env.DB_PASSWORD,
  database: process?.env.DB_NAME,

  max: Number(process?.env.DB_POOL_SIZE) || 20,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 5000,
});

/*
DATABASE CONNECTION
*/

export const connectDB = async () => {
  try {
    const client = await pool.connect();

    const res = await client.query("SELECT NOW()");

    console.log("PostgreSQL connected successfully");
    console.log("Database time:", res.rows[0].now);

    client.release();
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
    process.exit(1);
  }
};

/*
QUERY HELPER
*/

// export const query = async <T = any>(
//   text: string,
//   params?: unknown[]
// ): Promise<QueryResult<T>> => {
//   return pool.query(text, params);
// };

/*
TRANSACTION HELPER
*/

export const getClient = async () => {
  return pool.connect();
};

/*
GRACEFUL SHUTDOWN
*/

export const closeDB = async () => {
  try {
    await pool.end();
    console.log("PostgreSQL pool closed");
  } catch (error) {
    console.error("Error closing database pool:", error);
  }
};

/*
PROCESS SIGNAL HANDLERS
*/

process.on("SIGINT", async () => {
  await closeDB();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDB();
  process.exit(0);
});