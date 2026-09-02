import { loadBuildResults } from '@/lib/build-tests'
import { HatsGrid } from '@/components/HatsGrid'

export default async function HomePage() {
  const { nativeAvailable, browserAvailable, version, groups, latestVersion, commitsBehindMain, wasmSourceCommit, categories } = await loadBuildResults()
  return (
    <HatsGrid
      categories={categories}
      groups={groups}
      latestVersion={latestVersion}
      commitsBehindMain={commitsBehindMain}
      wasmSourceCommit={wasmSourceCommit}
      nativeAvailable={nativeAvailable}
      browserAvailable={browserAvailable}
      version={version}
    />
  )
}
