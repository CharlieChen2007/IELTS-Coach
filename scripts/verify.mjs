import { build } from 'esbuild'

const result = await build({
  entryPoints: ['scripts/verifyEntry.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'silent',
})

const code = result.outputFiles[0].text
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const { runVerification } = await import(moduleUrl)

try {
  const lines = runVerification()
  for (const line of lines) console.log(line)
  console.log(`\n全部通过：${lines.length} 项检查`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
