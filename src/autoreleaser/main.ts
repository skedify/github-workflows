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

    const version = context.ref.split('/').pop()

    if (version?.length !== 7)
      throw new Error(
        `This action expects to be ran on \`/release/XXXX-QX\` branches, received: ${version}`
      )

    await Promise.all(
      applications.map(async ({name}) => {
        const log = createLogger(name)
        const throwError = getPrefixedThrow(name)

        const {stdout} = await exec.getExecOutput(
          `git tag --list --sort=-version:refname \"${name}@${version}-rc.*\" | head -n 1`
        )

        const [latestTag] = stdout.split('\n')

        let nextTag: string

        if (IS_STABLE_RELEASE && stdout.length === 0)
          throwError(`Trying to release stable without an rc.0 version! Aborting...`)
        if (IS_STABLE_RELEASE) {
          nextTag = `${name}@${version}`
          // need to validate here if there is already a stable release.
        } else if (latestTag.length === 0) {
          log(`not tagged yet, starting at rc.0`)
          nextTag = `${name}@${version}-rc.0`
        } else {
          const currentRcVersion = latestTag.split('rc.').pop()

          if (typeof currentRcVersion !== 'string')
            throwError(`Couldn't determine next rc version, aborting... config: ${latestTag}`)

            // casting to string, we validate with throwError above.
          const nextRcVersion = Number.parseInt(currentRcVersion!) + 1

          nextTag = `${name}@${version}-rc.${nextRcVersion}`
        }

        log(`Tagging with ${nextTag}`);

        // TODO handle case where tag already exists for stable case.
        await octokitInstance.createRelease({
          tag: nextTag,
          sha: github.context.sha,
          prerelease: !IS_STABLE_RELEASE
        })
      })
    )
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
