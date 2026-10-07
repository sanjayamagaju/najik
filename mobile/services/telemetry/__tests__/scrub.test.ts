import { REDACTED, scrubString, scrubUrl, scrubValue } from '../scrub';

describe('telemetry scrubbing', () => {
  it('redacts tokens, passwords and message content by key', () => {
    expect(
      scrubValue({
        access: 'a',
        refresh: 'r',
        password: 'p',
        body: 'secret message',
        preview: 'secret preview',
        nested: { token: 't', conversation_id: 'c1' },
        list: [{ new_password: 'x' }],
      }),
    ).toEqual({
      access: REDACTED,
      refresh: REDACTED,
      password: REDACTED,
      body: REDACTED,
      preview: REDACTED,
      nested: { token: REDACTED, conversation_id: 'c1' },
      list: [{ new_password: REDACTED }],
    });
  });

  it('strips bearer tokens and JWTs from free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    expect(scrubString(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
    expect(scrubString(`token=${jwt}`)).toBe(`token=${REDACTED}`);
  });

  it('drops query strings (search terms) from URLs', () => {
    expect(scrubUrl('https://api.test/api/v1/users/search?q=arjun')).toBe(
      'https://api.test/api/v1/users/search',
    );
  });
});
