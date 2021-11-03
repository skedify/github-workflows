/* eslint-disable */
import * as core from '@actions/core'
import * as github from '@actions/github'
import {OctokitResponse} from '@octokit/types'
import {createOctokitInstance, createLogger, getPrefixedThrow } from '../utils'

const repos = [{repo: 'github-workflows', mainBranchName: 'develop'}]
// const repos = [{repo: 'frontend-mono', mainBranch: 'develop'}]

async function run(): Promise<void> {
  try {
    const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN')
    const releaseVersion = core.getInput('RELEASE_VERSION') || '2021-Q5'
    const finalizeReleaseInput = core.getInput('FINALISE_RELEASE') || 'N'

    const octokit = github.getOctokit(GITHUB_TOKEN)

    const finalizeRelease = finalizeReleaseInput === 'Y'

    await Promise.all(
      repos.map(async ({repo, mainBranchName}) => {
        const throwError = getPrefixedThrow(repo)
        const log = createLogger(repo)
        const octokitInstance = createOctokitInstance({octokit, repo})

        const releaseBranchName = `release/${releaseVersion}`

        try {
          //check branch
          log(`Checking for branch: ${releaseBranchName}`)
          await octokitInstance.getBranch(releaseBranchName)
          log('Found release branch!')
        } catch (err) {
          // branch does not exist
          // create branch
          log('Release branch not found!')
          if (finalizeRelease)
            throwError(
              `Trying to finalize ${releaseVersion} while the release branch doesn't exist, aborting...`
            )

          log(`Getting main branch: ${mainBranchName}`)
          const mainBranch = await octokitInstance.getBranch(mainBranchName)

          log(`Creating release branch: ${releaseBranchName}`)
          await octokitInstance.createBranch({
            branchName: releaseBranchName,
            sha: mainBranch.data.object.sha
          })
          log(`Release branch created: ${releaseBranchName}`)
        }

        if (finalizeRelease) {
          log(`Triggering \`autoreleaser.yml\` on \`${releaseBranchName}\``)
          await octokitInstance.triggerWorkflow({
            // TODO fix
            workflowName: 'autoreleaser.yml',
            branchName: releaseBranchName
          })
          log(`Triggered \`autoreleaser.yml\` on \`${releaseBranchName}\`!`)
        }
      })
    )
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
