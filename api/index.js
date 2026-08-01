/**
 * Vercel serverless entry point.
 * Re-exports the Express app so all routes (static + API) work on Vercel.
 */
module.exports = require("../server");
