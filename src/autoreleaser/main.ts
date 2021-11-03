/* eslint-disable */
import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'
import {createOctokitInstance, createLogger, getPrefixedThrow} from '../utils'

async function run(): Promise<void> {
  try {
    const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN')
    const applicationsJson = core.getInput('APPLICATIONS')
    const stableReleaseTag = core.getInput('STABLE_RELEASE') || 'false'

    const IS_STABLE_RELEASE = stableReleaseTag === 'true'

    const applications = JSON.parse(applicationsJson) as {name: string}[]

    const context = github.context

    const octokitInstance = createOctokitInstance({
      octokit: github.getOctokit(GITHUB_TOKEN),
      repo: context.repo.repo
    })

    if (!context.ref.startsWith('refs/heads/release/'))
      throw new Error('This action expects to be ran on `/release/XXXX-QX` branches.')

    const releaseName = context.ref.split('/').pop()

    if (releaseName?.length !== 7)
      throw new Error(
        `This action expects to be ran on \`/release/XXXX-QX\` branches, received: ${releaseName}`
      )

    await Promise.all(
      applications.map(async ({name}) => {
        const log = createLogger(name)
        const throwError = getPrefixedThrow(name)

        const {stdout: hasStableReleaseOutput} = await exec.getExecOutput(
          `git tag --list \"${name}@${releaseName}\"`
        )

        const HAS_STABLE_RELEASE = hasStableReleaseOutput.length > 0

        const {stdout: lastestRcTagOutput} = await exec.getExecOutput(
          `git tag --list --sort=-version:refname \"${name}@${releaseName}-rc.*\" | head -n 1`
        )

        const {stdout: lastestHotfixTagOutput} = await exec.getExecOutput(
          `git tag --list --sort=-version:refname \"${name}@${releaseName}-hotfix.*\" | head -n 1`
        )

        const [latestRcTag] = lastestRcTagOutput.split('\n')
        const [latestHotfixTag] = lastestHotfixTagOutput.split('\n')

        if (IS_STABLE_RELEASE && latestRcTag.length === 0)
          throwError(`Trying to release stable without an rc.0 version! Aborting...`)

        if (IS_STABLE_RELEASE && HAS_STABLE_RELEASE)
          throwError(`Trying to release stable when it already exists! Aborting...`)

        const nextTag = IS_STABLE_RELEASE
          ? `${name}@${releaseName}`
          : determineNextTag({
              type: HAS_STABLE_RELEASE ? 'hotfix' : 'rc',
              latestTag: HAS_STABLE_RELEASE ? latestHotfixTag : latestRcTag,
              name,
              releaseName,
              log,
              throwError
            })

        log(`Tagging with ${nextTag}`)

        // TODO handle case where tag already exists for stable case.
        await octokitInstance.createRelease({
          tag: nextTag,
          sha: github.context.sha,
          prerelease: !IS_STABLE_RELEASE && !HAS_STABLE_RELEASE
        })
      })
    )
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()

function determineNextTag({
  type,
  latestTag,
  name,
  releaseName,
  log,
  throwError
}: {
  type: 'rc' | 'hotfix'
  latestTag: string
  name: string
  releaseName: string
  log: (message: string) => void
  throwError: (message: string) => never
}) {
  if (latestTag.length === 0) {
    log(`not tagged yet, starting at ${type}.0`)
    return createTag({name, releaseName, type, version: 0})
  } else {
    const currentVersion = latestTag.split(`${type}.`).pop()

    if (typeof currentVersion !== 'string')
      throwError(`Couldn't determine next ${type} version, aborting... config: ${latestTag}`)

    // casting to string, we validate with throwError above.
    const nextVersion = Number.parseInt(currentVersion!) + 1

    return createTag({name, releaseName, type, version: nextVersion})
  }
}

function createTag({
  name,
  releaseName,
  type,
  version
}: {
  name: string
  releaseName: string
  type: 'rc' | 'hotfix'
  version: number
}) {
  return `${name}@${releaseName}-${type}.${version}`
}
