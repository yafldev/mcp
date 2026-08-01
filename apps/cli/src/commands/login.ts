import open from 'open'
import { requestAndPoll, save, DeviceFlowExpiredError, DeviceFlowDeniedError } from '@yafl/client'
import type { CommandContext } from '../index.js'

/**
 * `yafl login` – RFC 8628 device flow: under `--json`, `onPrompt` emits a
 * single NDJSON line (`{"status":"pending",...}`) with the real
 * verificationUri/userCode/verificationUriComplete values, and nothing else,
 * so an agent can `JSON.parse` every stdout line; otherwise it prints the
 * human prose – the verification URL and the code, each alone on its own
 * indented line so both are instantly scannable and copy-pasteable (agents
 * running headless on a VPS have no browser to auto-open). Either way, it
 * then tries `open` for a local browser unless `--no-browser` is set or
 * `open` itself throws/rejects (e.g. no DISPLAY on a headless box) – that
 * failure is swallowed, never fatal, since the prompt was already printed.
 */
export async function runLogin(ctx: CommandContext): Promise<number> {
  const noBrowser = Boolean(ctx.flags['no-browser'])

  try {
    const result = await requestAndPoll(ctx.apiUrl, {
      onPrompt: (prompt) => {
        if (ctx.json) {
          ctx.print(
            JSON.stringify({
              status: 'pending',
              verificationUri: prompt.verificationUri,
              userCode: prompt.userCode,
              verificationUriComplete: prompt.verificationUriComplete,
            }),
          )
        } else {
          ctx.print('')
          ctx.print('YAFL moves files between machines and agents, encrypted end to end.')
          ctx.print('')
          ctx.print('Open this URL in your browser:')
          ctx.print('')
          ctx.print(`  ${prompt.verificationUri}`)
          ctx.print('')
          ctx.print('And enter this code:')
          ctx.print('')
          ctx.print(`  ${prompt.userCode}`)
          ctx.print('')
          ctx.print(
            'Approving happens in your browser: you sign in with a one-time email link, which proves you control the email address that owns this key.',
          )
        }
        if (!noBrowser) {
          open(prompt.verificationUriComplete).catch(() => {
            // Headless/no-DISPLAY environment – the prompt above is already
            // printed, so this is not a failure.
          })
        }
      },
    })

    await save({ apiKey: result.apiKey, keyName: result.keyName }, { env: ctx.env })

    if (ctx.json) {
      ctx.print(JSON.stringify({ status: 'ok', keyName: result.keyName }))
    } else {
      ctx.print(`Logged in. Stored key for "${result.keyName}".`)
    }
    return 0
  } catch (err) {
    if (err instanceof DeviceFlowExpiredError || err instanceof DeviceFlowDeniedError) {
      ctx.printErr(err.message)
      return 1
    }
    throw err
  }
}
