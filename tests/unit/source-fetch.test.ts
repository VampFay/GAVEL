import { describe, it, expect, vi, beforeEach } from 'vitest'

// dns.lookup is mocked so URL-fetch tests never touch the real resolver.
// Tests steer it per-case by setting dnsLookup.mockResolvedValueOnce(...).
const { dnsLookup } = vi.hoisted(() => ({ dnsLookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({
  default: { lookup: dnsLookup },
}))

import {
  isPrivateAddress,
  assertPublicHttpsUrl,
  htmlToText,
  fetchTextFromUrl,
  fetchTextFromGithub,
  SourceFetchError,
} from '../../src/lib/sources/fetch-remote'
import { SourceFetchSchema } from '../../src/lib/schemas'

const PUBLIC_A = [{ address: '93.184.216.34', family: 4 }]
const res = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/plain', ...init.headers },
    ...init,
  })

beforeEach(() => {
  dnsLookup.mockReset()
  dnsLookup.mockResolvedValue(PUBLIC_A) // default: resolves publicly
})

// ── isPrivateAddress ────────────────────────────────────────────────────────

describe('isPrivateAddress', () => {
  it('blocks the private/reserved IPv4 ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1', // CGNAT
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '198.18.0.5',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4 and rejects garbage', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
    expect(isPrivateAddress('172.32.0.1')).toBe(false) // just outside 172.16/12
    expect(isPrivateAddress('999.1.1.1')).toBe(false) // not a valid literal → treated as hostname
    expect(isPrivateAddress('example.com')).toBe(false)
  })

  it('blocks loopback/ULA/link-local/multicast IPv6 and validates mapped v4', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('::')).toBe(true)
    expect(isPrivateAddress('fc00::1')).toBe(true)
    expect(isPrivateAddress('fd12:3456::1')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
    expect(isPrivateAddress('ff02::1')).toBe(true)
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true) // v4-mapped
    expect(isPrivateAddress('::ffff:93.184.216.34')).toBe(false)
    expect(isPrivateAddress('2606:2800:220:1::1')).toBe(false)
  })
})

// ── assertPublicHttpsUrl ───────────────────────────────────────────────────

describe('assertPublicHttpsUrl', () => {
  it('rejects non-https, malformed urls, and private literals', async () => {
    await expect(assertPublicHttpsUrl('http://example.com/x')).rejects.toThrow(
      /only https/,
    )
    await expect(assertPublicHttpsUrl('not a url')).rejects.toThrow(/not a valid URL/)
    await expect(assertPublicHttpsUrl('https://10.0.0.5/x')).rejects.toThrow(
      /private\/loopback/,
    )
    await expect(assertPublicHttpsUrl('https://[::1]/x')).rejects.toThrow(
      /private\/loopback/,
    )
  })

  it('rejects hostnames that DNS-resolve into private space (rebinding guard)', async () => {
    dnsLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.0.7', family: 4 }, // one bad A record is enough
    ])
    await expect(assertPublicHttpsUrl('https://rebind.example.com/x')).rejects.toThrow(
      /SSRF/,
    )
  })

  it('rejects unresolvable hosts and passes clean ones', async () => {
    dnsLookup.mockRejectedValueOnce(new Error('ENOTFOUND'))
    await expect(assertPublicHttpsUrl('https://nx.example.com/x')).rejects.toThrow(
      /DNS lookup failed/,
    )
    const url = await assertPublicHttpsUrl('https://good.example.com/x')
    expect(url.hostname).toBe('good.example.com')
  })

  it('skips DNS for IP literals', async () => {
    await assertPublicHttpsUrl('https://93.184.216.34/x')
    expect(dnsLookup).not.toHaveBeenCalled()
  })
})

// ── htmlToText ──────────────────────────────────────────────────────────────

describe('htmlToText', () => {
  it('drops scripts/styles/comments and decodes entities', () => {
    const html =
      '<!DOCTYPE html><html><head><style>.x{color:red}</style></head>' +
      '<body><!-- nav --><script>alert(1)</script>' +
      '<h1>Statement&nbsp;of Work</h1><p>R&amp;D &quot;phase&quot; &#65;</p></body></html>'
    const text = htmlToText(html)
    expect(text).toContain('Statement of Work')
    expect(text).toContain('R&D "phase" A')
    expect(text).not.toMatch(/alert|color:red|nav --/)
  })

  it('turns block tags into newlines and list items into bullets', () => {
    const text = htmlToText(
      '<p>one</p><div>two</div><ul><li>alpha</li><li>beta</li></ul><br>tail',
    )
    const lines = text.split('\n').map(s => s.trim())
    expect(lines).toContain('one')
    expect(lines).toContain('two')
    expect(lines).toContain('• alpha')
    expect(lines).toContain('• beta')
    expect(lines).toContain('tail')
  })
})

// ── fetchTextFromUrl ────────────────────────────────────────────────────────

describe('fetchTextFromUrl', () => {
  it('returns plain text with metadata', async () => {
    const fetchImpl = vi.fn(async () => res('SOW body text'))
    const out = await fetchTextFromUrl('https://docs.example.com/sow.txt', fetchImpl)
    expect(out.text).toBe('SOW body text')
    expect(out.contentType).toContain('text/plain')
    expect(out.bytes).toBe(13) // 'SOW body text'.length
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('converts text/html bodies to cleaned text', async () => {
    const fetchImpl = vi.fn(async () =>
      res('<html><body><h1>Title</h1><script>x()</script><p>Body</p></body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    )
    const out = await fetchTextFromUrl('https://docs.example.com/sow', fetchImpl)
    expect(out.text).toContain('Title')
    expect(out.text).toContain('Body')
    expect(out.text).not.toContain('x()')
  })

  it('follows redirects manually and re-validates every hop', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('hop1')) {
        return res('', { status: 302, headers: { location: 'https://hop2.example.com/final' } })
      }
      return res('landed')
    })
    const out = await fetchTextFromUrl('https://hop1.example.com/a', fetchImpl)
    expect(out.text).toBe('landed')
    expect(out.finalUrl).toBe('https://hop2.example.com/final')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('refuses a redirect into private address space', async () => {
    dnsLookup.mockImplementation(async (host: string) =>
      host.startsWith('evil')
        ? [{ address: '169.254.169.254', family: 4 }]
        : PUBLIC_A,
    )
    const fetchImpl = vi.fn(async () =>
      res('', { status: 301, headers: { location: 'https://evil.example.com/metadata' } }),
    )
    await expect(fetchTextFromUrl('https://public.example.com/a', fetchImpl)).rejects.toThrow(
      /SSRF/,
    )
    // the private hop was never fetched
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('caps the redirect chain at 3 hops', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const n = Number(/\/hop(\d)/.exec(url)?.[1] ?? '0')
      return res('', { status: 302, headers: { location: `https://example.com/hop${n + 1}` } })
    })
    await expect(fetchTextFromUrl('https://example.com/hop0', fetchImpl)).rejects.toThrow(
      /too many redirects/,
    )
    expect(fetchImpl).toHaveBeenCalledTimes(4) // initial + 3 followed
  })

  it('maps upstream status codes to friendly errors', async () => {
    const fetchImpl = vi.fn(async () => res('gone', { status: 404 }))
    const err = await fetchTextFromUrl('https://example.com/x', fetchImpl).catch(e => e)
    expect(err).toBeInstanceOf(SourceFetchError)
    expect(err.status).toBe(404)

    const fetch500 = vi.fn(async () => res('boom', { status: 500 }))
    const err2 = await fetchTextFromUrl('https://example.com/x', fetch500).catch(e => e)
    expect(err2.status).toBe(502)
  })

  it('rejects non-textual content types', async () => {
    const fetchImpl = vi.fn(async () =>
      res('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }),
    )
    await expect(fetchTextFromUrl('https://example.com/sow.pdf', fetchImpl)).rejects.toThrow(
      /only text sources/,
    )
  })

  it('enforces the 2 MB response cap', async () => {
    const chunk = 'x'.repeat(1024 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    })
    const fetchImpl = vi.fn(
      async () =>
        new Response(stream, { headers: { 'content-type': 'text/plain' } }),
    )
    await expect(fetchTextFromUrl('https://big.example.com/x', fetchImpl)).rejects.toThrow(
      /2 MB cap/,
    )
  })

  it('fails closed when the request itself errors (timeout/DNS)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(fetchTextFromUrl('https://example.com/x', fetchImpl)).rejects.toThrow(
      /request failed/,
    )
  })
})

// ── fetchTextFromGithub ─────────────────────────────────────────────────────

describe('fetchTextFromGithub', () => {
  const req = { owner: 'acme', repo: 'contracts', path: 'docs/sow.md' }

  it('returns raw file content for a happy path', async () => {
    const fetchImpl = vi.fn(async () =>
      res('# SOW\n\nDeliverables as agreed.', {
        headers: { 'content-type': 'application/vnd.github.raw' },
      }),
    )
    const out = await fetchTextFromGithub(req, fetchImpl)
    expect(out.text).toContain('# SOW')
    expect(fetchImpl.mock.calls[0][0]).toContain(
      '/repos/acme/contracts/contents/docs/sow.md',
    )
  })

  it('rejects path traversal and absolute paths before any request', async () => {
    const fetchImpl = vi.fn(async () => res('x'))
    for (const path of ['../secret', 'docs/../../etc/passwd', '/etc/passwd']) {
      await expect(fetchTextFromGithub({ ...req, path }, fetchImpl)).rejects.toThrow(
        /repo-relative/,
      )
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps 404 to a check-owner/repo/path message', async () => {
    const fetchImpl = vi.fn(async () => res('{}', { status: 404 }))
    await expect(fetchTextFromGithub(req, fetchImpl)).rejects.toThrow(/404/)
  })

  it('maps exhausted rate limits to 429 with the PAT advice', async () => {
    const fetchImpl = vi.fn(
      async () =>
        res('{}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    )
    const err = await fetchTextFromGithub(req, fetchImpl).catch(e => e)
    expect(err.status).toBe(429)
    expect(err.message).toMatch(/personal access token/)
  })

  it('distinguishes 401 bad-token from 403 scope failures', async () => {
    const fetch401 = vi.fn(async () => res('{}', { status: 401 }))
    await expect(fetchTextFromGithub(req, fetch401)).rejects.toThrow(/rejected the token/)

    const fetch403 = vi.fn(async () => res('{}', { status: 403 }))
    await expect(fetchTextFromGithub(req, fetch403)).rejects.toThrow(/403/)
  })

  it('rejects directory listings with a point-at-a-file message', async () => {
    const fetchImpl = vi.fn(async () =>
      res(JSON.stringify([{ name: 'sow.md' }, { name: 'sla.md' }]), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    await expect(fetchTextFromGithub({ ...req, path: 'docs' }, fetchImpl)).rejects.toThrow(
      /directory/,
    )
  })

  it('rejects empty files with 422', async () => {
    const fetchImpl = vi.fn(async () =>
      res('   ', { headers: { 'content-type': 'text/plain' } }),
    )
    const err = await fetchTextFromGithub(req, fetchImpl).catch(e => e)
    expect(err.status).toBe(422)
  })

  it('sends the token and ref when provided', async () => {
    const fetchImpl = vi.fn(async () =>
      res('body', { headers: { 'content-type': 'text/plain' } }),
    )
    await fetchTextFromGithub({ ...req, ref: 'v2', token: 'ghp_x' }, fetchImpl)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('ref=v2')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ghp_x' })
  })
})

// ── SourceFetchSchema ───────────────────────────────────────────────────────

describe('SourceFetchSchema', () => {
  it('accepts a valid url fetch and rejects non-https or short urls', () => {
    expect(SourceFetchSchema.safeParse({ kind: 'url', url: 'https://example.com/sow' }).success).toBe(true)
    expect(SourceFetchSchema.safeParse({ kind: 'url', url: 'http://example.com/sow' }).success).toBe(false)
    expect(SourceFetchSchema.safeParse({ kind: 'url', url: 'https:/x' }).success).toBe(false) // malformed scheme
  })

  it('accepts a valid github fetch and rejects missing fields', () => {
    expect(
      SourceFetchSchema.safeParse({ kind: 'github', owner: 'a', repo: 'b', path: 'c.md' }).success,
    ).toBe(true)
    expect(SourceFetchSchema.safeParse({ kind: 'github', owner: 'a', repo: 'b' }).success).toBe(false)
    expect(SourceFetchSchema.safeParse({ kind: 'dropbox', anything: true }).success).toBe(false)
  })
})
