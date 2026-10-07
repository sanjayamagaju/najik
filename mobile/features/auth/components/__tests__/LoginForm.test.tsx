import { fireEvent, render, screen } from '@testing-library/react-native';

import { ApiError } from '@/services/api/errors';

import { validateRegisterForm, validateUsername } from '../../validation';
import { LoginForm } from '../LoginForm';

describe('LoginForm', () => {
  it('validates required fields and does not submit', async () => {
    const onSubmit = jest.fn(async () => undefined);
    await render(<LoginForm onSubmit={onSubmit} />);
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(screen.getByText('Enter your username')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects malformed usernames', async () => {
    const onSubmit = jest.fn(async () => undefined);
    await render(<LoginForm onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('login-username'), 'a b');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'whatever1');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(screen.getByText('Only letters, numbers, "_" and "."')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed-valid credentials', async () => {
    const onSubmit = jest.fn(async () => undefined);
    await render(<LoginForm onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('login-username'), 'arjun.rai');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'correct horse');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ username: 'arjun.rai', password: 'correct horse' });
  });

  it('shows a friendly message for invalid credentials', async () => {
    const onSubmit = jest.fn(async () => {
      throw new ApiError({ status: 401, code: 'invalid_credentials', message: 'Invalid' });
    });
    await render(<LoginForm onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('login-username'), 'arjun');
    await fireEvent.changeText(screen.getByTestId('login-password'), 'nope-nope');
    await fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByText('Wrong username or password.')).toBeTruthy();
  });
});

describe('auth validation rules (PROTOCOL §3)', () => {
  it('username: ^[a-zA-Z0-9_.]{3,24}$', () => {
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('a'.repeat(25))).not.toBeNull();
    expect(validateUsername('arjun_rai.99')).toBeNull();
  });

  it('register: display name, password length and optional email', () => {
    expect(
      validateRegisterForm({ username: 'arjun', displayName: ' ', password: 'short', email: 'x' }),
    ).toEqual({
      displayName: 'Enter your name',
      password: 'At least 8 characters',
      email: 'Enter a valid email',
    });
    expect(
      validateRegisterForm({
        username: 'arjun',
        displayName: 'Arjun',
        password: 'long enough',
        email: '',
      }),
    ).toEqual({});
  });
});
