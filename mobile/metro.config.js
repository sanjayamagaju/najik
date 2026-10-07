// Sentry's Expo metro config adds debug IDs so release source maps resolve.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
