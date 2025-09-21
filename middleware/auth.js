const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  const token = req.headers["authorization"];
  if (!token) return res.status(403).json({ message: "Access denied" });

  try {
    const verified = jwt.verify(token, "SECRET_KEY"); // change to env variable
    req.admin = verified;
    next();
  } catch (err) {
    res.status(400).json({ message: "Invalid token" });
  }
};
