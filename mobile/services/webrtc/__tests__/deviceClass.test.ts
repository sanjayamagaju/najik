import { classifyDevice, DEVICE_CLASS_CAP } from '../deviceClass';

const GB = 1024 ** 3;

describe('device class cap', () => {
  it('caps low-end devices (little RAM or old) at 480p', () => {
    expect(classifyDevice({ totalMemory: 2 * GB, yearClass: 2023 })).toBe('low');
    expect(classifyDevice({ totalMemory: 8 * GB, yearClass: 2016 })).toBe('low');
    expect(DEVICE_CLASS_CAP.low).toBe('480p');
  });

  it('mid devices → 720p, recent high-memory devices → 1080p, unknown → high', () => {
    expect(classifyDevice({ totalMemory: 4 * GB, yearClass: 2022 })).toBe('mid');
    expect(classifyDevice({ totalMemory: 8 * GB, yearClass: 2019 })).toBe('mid');
    expect(classifyDevice({ totalMemory: 8 * GB, yearClass: 2023 })).toBe('high');
    expect(classifyDevice({ totalMemory: null, yearClass: null })).toBe('high');
    expect(DEVICE_CLASS_CAP.mid).toBe('720p');
  });
});
