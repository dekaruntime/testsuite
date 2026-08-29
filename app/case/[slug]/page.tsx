import { notFound } from 'next/navigation'
import { loadTestBySlug, getAllSlugs } from '@/lib/tests'
import { loadBuildResults } from '@/lib/build-tests'
import { CaseRunner } from '@/components/CaseRunner'

interface CasePageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }))
}

export default async function CasePage({ params }: CasePageProps) {
  const { slug } = await params
  const test = loadTestBySlug(slug)

  if (!test) {
    notFound()
  }

  const { categories } = await loadBuildResults()

  // Hand the page its OWN record and its next link, never the whole corpus.
  // Passing `categories` inlined all 722 tests into all 722 pages: ~1.6MB each,
  // ~1.1GB total for 1.45MB of data, and — because every page then embedded
  // global state — one test changing flipped the content hash of every page, so
  // Cloudflare re-uploaded ~2,100 assets on every deploy instead of the delta.
  // The contents sidebar fetches /hats-results.json on demand instead.
  const ordered = categories.flatMap((group) => group.tests)
  const dumpRecord = ordered.find((item) => item.slug === slug)
  const index = ordered.findIndex((item) => item.slug === slug)
  const nextSlug =
    index >= 0 && index < ordered.length - 1 ? ordered[index + 1].slug : undefined

  return <CaseRunner test={test} dumpRecord={dumpRecord} nextSlug={nextSlug} />
}
