/* eslint-disable */
import * as core from '@actions/core'
import * as github from '@actions/github'
import {createOctokitInstance, createLogger, getPrefixedThrow} from '../utils'

const repos = [{repo: 'github-workflows', mainBranchName: 'develop'}]
// const repos = [{repo: 'frontend-mono', mainBranch: 'develop'}]
const getOptionalInput = (name: string) => core.getInput(name) || undefined

const WORKFLOW_NAME = 'release-branch-tagger.yml'

;(async () => {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN

  if (!GITHUB_TOKEN) {
    core.setFailed('Please add the GITHUB_TOKEN to the release-branch-tagger action')
    return
  }

  const releaseName = core.getInput('release-name')
  const finalizeReleaseInput = getOptionalInput('finalize-release') || 'N'
  const finalizeRelease = finalizeReleaseInput === 'Y'

  const octokit = github.getOctokit(GITHUB_TOKEN)

  const taskResults = await Promise.allSettled(
    repos.map(async ({repo, mainBranchName}) => {
      const log = createLogger(repo)
      const octokitInstance = createOctokitInstance({octokit, repo})

      const releaseBranchName = `release/${releaseName}`

      try {
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
            throw new Error(
              `Trying to finalize ${releaseName} while the release branch doesn't exist, aborting...`
            )

          log(`Getting main branch: ${mainBranchName}`)
          // TODO: currently we assume we can always take latest commit from main branch. This might contain unreleased changes though. Is this OK?
          const mainBranch = await octokitInstance.getBranch(mainBranchName)

          log(`Creating release branch: ${releaseBranchName}`)
          await octokitInstance.createBranch({
            branchName: releaseBranchName,
            sha: mainBranch.data.object.sha
          })
          log(`Release branch created: ${releaseBranchName}`)
        }

        if (finalizeRelease) {
          log(`Triggering \`${WORKFLOW_NAME}\` on \`${releaseBranchName}\``)
          await octokitInstance.triggerWorkflow({
            // TODO fix
            workflowName: WORKFLOW_NAME,
            branchName: releaseBranchName
          })
          log(`Triggered \`${WORKFLOW_NAME}\` on \`${releaseBranchName}\`!`)
        }
      } catch (err) {
        const throwError = getPrefixedThrow(repo)
        // catch all errors and rethrow them with prefix, or rethrow original error
        if (err instanceof Error) throwError(err.message)
        throw err
      }
    })
  )

  const errorMessages = taskResults.reduce(
    (text, res) => (res.status === 'rejected' ? text + res.reason.message + '\n' : text),
    ''
  )

  if (errorMessages) throw new Error(errorMessages)
})().catch(err => {
  console.error(err)
  core.setFailed(err.message)
})
