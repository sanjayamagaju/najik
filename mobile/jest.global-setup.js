// Deterministic dates in tests regardless of the machine's timezone.
module.exports = async () => {
  process.env.TZ = 'UTC';
};
