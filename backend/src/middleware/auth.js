const jwt = require("jsonwebtoken");


const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set");
  process.exit(1);
}

// Authentication middleware
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
};

// Role authorization middleware
const authorize = (roles = []) => {
  if (typeof roles === "string") {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: "Unauthorized. User context missing." });
    }

    // Role-based verification
    if (roles.length && !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: `Forbidden. Requires role: ${roles.join(" or ")}` });
    }

    next();
  };
};

// MISSING AUTHORIZATION CHECK: This middleware is meant for Admin actions but is empty
// or fails to check the role, allowing any authenticated user (e.g. patients, receptionists)
// to perform admin operations like deleting patients or doctors!
//MY FIX
const authorizeAdminOnlyLegacy = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized." });
  if (req.user.role !== "ADMIN") {
    return res
      .status(403)
      .json({ error: "Access denied. Admin role required." });
  }
  next();
};

module.exports = {
  authenticate,
  authorize,
  authorizeAdminOnlyLegacy,
};
