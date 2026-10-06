import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Server } from 'lucide-react';
import { Sheet } from './Sheet';
import { TextField } from './TextField';
import { Button } from './Button';
import { getServerUrl, setServerUrl } from '../lib/config';

type Check = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'error'; message: string };

export function ServerSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const [url, setUrl] = useState(getServerUrl());
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  useEffect(() => {
    if (open) {
      setUrl(getServerUrl());
      setCheck({ state: 'idle' });
    }
  }, [open]);

  const save = async () => {
    const value = url.trim().replace(/\/+$/, '');
    if (value && !/^https?:\/\//i.test(value)) {
      setCheck({ state: 'error', message: 'Start with http:// or https://' });
      return;
    }
    setCheck({ state: 'checking' });
    try {
      const res = await fetch(`${value}/api/health`, { signal: AbortSignal.timeout(6000) });
      const data = (await res.json()) as { name?: string };
      if (data.name !== 'najik') throw new Error('That server is not a Najik server');
      setServerUrl(value);
      setCheck({ state: 'ok' });
      window.setTimeout(() => {
        onClose();
        onSaved?.();
      }, 450);
    } catch (err) {
      const message = (err as Error).message.includes('Najik') ? (err as Error).message : "Couldn't reach that server";
      setCheck({ state: 'error', message });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Server">
      <div className="space-y-4 px-3 pt-1">
        <p className="text-sm text-muted">
          The address of your Najik server, e.g. <span className="font-mono text-ink">https://najik.example.com</span>
        </p>
        <TextField
          label="Server URL"
          icon={Server}
          value={url}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        {check.state === 'error' && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="text-sm text-danger">
            {check.message}
          </motion.p>
        )}
        <Button className="w-full" loading={check.state === 'checking'} onClick={() => void save()}>
          {check.state === 'ok' ? 'Connected ✓' : 'Save & test'}
        </Button>
      </div>
    </Sheet>
  );
}
