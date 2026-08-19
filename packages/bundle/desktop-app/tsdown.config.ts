import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-desktop-app',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { hostPhase: true, clientEntry: 'src/client/index.ts' },
)
