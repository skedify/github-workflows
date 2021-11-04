/* eslint-disable */
import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'
import {createOctokitInstance, createLogger, getPrefixedThrow} from '../utils'

async function run(): Promise<void> {
  try {
    const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN')
    const applicationsJson = core.getInput('APPLICATIONS')
    const stableReleaseInput = core.getInput('STABLE_RELEASE') || 'false'

    const IS_STABLE_RELEASE = stableReleaseInput === 'true'

    const applications = JSON.parse(applicationsJson) as {name: string}[]

    const octokitInstance = createOctokitInstance({
      octokit: github.getOctokit(GITHUB_TOKEN),
      repo: github.context.repo.repo
    })

    if (!github.context.ref.startsWith('refs/heads/release/'))
      throw new Error('This action expects to be ran on `/release/XXXX-QX` branches.')

    const releaseName = github.context.ref.split('/').pop()

    if (releaseName?.length !== 7)
      throw new Error(
        `This action expects to be ran on \`/release/XXXX-QX\` branches, received: ${releaseName}`
      )

    const taskResults = await Promise.allSettled(
      applications.map(async ({name}) => {
        const log = createLogger(name)

        try {
          const {stdout: hasStableReleaseOutput} = await exec.getExecOutput(
            `git tag --list \"${name}@${releaseName}\"`
          )

          const HAS_STABLE_RELEASE = hasStableReleaseOutput.length > 0

          if (IS_STABLE_RELEASE && HAS_STABLE_RELEASE)
            throw new Error(`Trying to release stable when it already exists! Aborting...`)

          const {stdout: lastestRcTagOutput} = await exec.getExecOutput(
            `git tag --list --sort=-version:refname \"${name}@${releaseName}-rc.*\" | head -n 1`
          )

          const [latestRcTag] = lastestRcTagOutput.split('\n')

          if (IS_STABLE_RELEASE && latestRcTag.length === 0)
            throw new Error(`Trying to release stable without an rc.0 version! Aborting...`)

          const {stdout: lastestHotfixTagOutput} = await exec.getExecOutput(
            `git tag --list --sort=-version:refname \"${name}@${releaseName}-hotfix.*\" | head -n 1`
          )

          const [latestHotfixTag] = lastestHotfixTagOutput.split('\n')

          const nextTag = IS_STABLE_RELEASE
            ? `${name}@${releaseName}`
            : determineNextTag({
                type: HAS_STABLE_RELEASE ? 'hotfix' : 'rc',
                latestTag: HAS_STABLE_RELEASE ? latestHotfixTag : latestRcTag,
                name,
                releaseName,
                log
              })

          log(`Tagging with ${nextTag}`)

          // TODO handle case where tag already exists for stable case.
          await octokitInstance.createRelease({
            tag: nextTag,
            sha: github.context.sha,
            prerelease: !IS_STABLE_RELEASE && !HAS_STABLE_RELEASE
          })
        } catch (err) {
          const throwError = getPrefixedThrow(name)
          // catch all errors and rethrow them with prefix, or rethrow original error
          if (err instanceof Error) throwError(err.message)
          throw err
        }
      })
    )

    const errorMessages = taskResults.reduce((text, res) => {
      if (res.status === 'rejected') return text + res.reason.message + '\n'

      return text
    }, '')

    if (errorMessages) {
      core.setFailed(errorMessages)
    }
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
  log
}: {
  type: 'rc' | 'hotfix'
  latestTag: string
  name: string
  releaseName: string
  log: (message: string) => void
}) {
  if (latestTag.length === 0) {
    log(`not tagged yet, starting at ${type}.0`)
    return createTag({name, releaseName, type, version: 0})
  } else {
    const currentVersion = latestTag.split(`${type}.`).pop()

    if (typeof currentVersion !== 'string')
      throw new Error(`Couldn't determine next ${type} version, aborting... config: ${latestTag}`)

    const nextVersion = Number.parseInt(currentVersion) + 1

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
