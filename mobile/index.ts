// Custom entry: background/headless tasks must be defined before the app (and in headless JS,
// where no UI is rendered). Then hand over to Expo Router.
import './services/notifications/backgroundTask';
// Registers `call.incoming` / `call.ended` push handlers (headless-safe: no UI imports).
import './features/calls/push';
import 'expo-router/entry';
