/** Client-side mirrors of the PROTOCOL §3 field rules (the server remains authoritative). */

export const USERNAME_RE = /^[a-zA-Z0-9_.]{3,24}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MAX = 48;

export function validateUsername(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your username';
  if (v.length < 3) return 'At least 3 characters';
  if (v.length > 24) return 'At most 24 characters';
  if (!USERNAME_RE.test(v)) return 'Only letters, numbers, "_" and "."';
  return null;
}

export function validatePassword(value: string, { forLogin = false } = {}): string | null {
  if (!value) return 'Enter your password';
  if (forLogin) return null;
  if (value.length < PASSWORD_MIN) return `At least ${PASSWORD_MIN} characters`;
  if (value.length > PASSWORD_MAX) return `At most ${PASSWORD_MAX} characters`;
  return null;
}

export function validateDisplayName(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Enter your name';
  if (v.length > DISPLAY_NAME_MAX) return `At most ${DISPLAY_NAME_MAX} characters`;
  return null;
}

export function validateEmail(value: string): string | null {
  const v = value.trim();
  if (!v) return null; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Enter a valid email';
}

export interface LoginForm {
  username: string;
  password: string;
}

export interface RegisterForm extends LoginForm {
  displayName: string;
  email: string;
}

export type FormErrors<T> = Partial<Record<keyof T, string>>;

export function validateLoginForm(form: LoginForm): FormErrors<LoginForm> {
  const errors: FormErrors<LoginForm> = {};
  const u = validateUsername(form.username);
  const p = validatePassword(form.password, { forLogin: true });
  if (u) errors.username = u;
  if (p) errors.password = p;
  return errors;
}

export function validateRegisterForm(form: RegisterForm): FormErrors<RegisterForm> {
  const errors: FormErrors<RegisterForm> = {};
  const u = validateUsername(form.username);
  const d = validateDisplayName(form.displayName);
  const p = validatePassword(form.password);
  const e = validateEmail(form.email);
  if (u) errors.username = u;
  if (d) errors.displayName = d;
  if (p) errors.password = p;
  if (e) errors.email = e;
  return errors;
}

export const hasErrors = (errors: object) => Object.keys(errors).length > 0;
