/* eslint-disable */
import * as core from '@actions/core'
import * as github from '@actions/github'
import {OctokitResponse} from '@octokit/types'
import {createOctokitInstance} from '../utils'

const repos = [{repo: 'github-workflows', mainBranchName: 'develop'}]
// const repos = [{repo: 'frontend-mono', mainBranch: 'develop'}]

function getPrefixedThrow(prefix: string) {
  return function throwError(message: string): never {
    throw new Error(`${prefix}: ${message}`)
  }
}

async function run(): Promise<void> {
  try {
    const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN')
    const releaseVersion = core.getInput('RELEASE_VERSION') || '2021-Q5'
    const finalizeReleaseInput = core.getInput('FINALISE_RELEASE') || 'N'

    const octokit = github.getOctokit(GITHUB_TOKEN)

    const finalizeRelease = finalizeReleaseInput === 'Y'

    await Promise.all(
      repos.map(async ({ repo, mainBranchName }) => {
        const throwError = getPrefixedThrow(repo)
        const octokitInstance = createOctokitInstance({octokit, repo})

        let releaseBranch: OctokitResponse<
          {
            ref: string
            node_id: string
            url: string
            object: {
              type: string
              sha: string
              url: string
            }
          },
          201 | 200
        >

        const releaseBranchName = `release/${releaseVersion}`

        try {
          //check branch
          console.log('Checking branch...')
          releaseBranch = await octokitInstance.getBranch(releaseBranchName)
        } catch (err) {
          // branch does not exist
          // create branch
          console.log('Branch not found')
          if (finalizeRelease)
            throwError(
              `Trying to finalize ${releaseVersion} while the release branch doesn't exist.`
            )

          console.log('Getting main branch...')
          const mainBranch = await octokitInstance.getBranch(mainBranchName)

          console.log('Creating release branch...')
          releaseBranch = await octokitInstance.createBranch({
            branchName: releaseBranchName,
            sha: mainBranch.data.object.sha
          })
        }

        if (finalizeRelease) {
          try {
            console.log('Checking release tag: ', releaseVersion)

            await octokitInstance.getTag(releaseVersion)

            console.log('Tag already exists!')
            throwError(`Release tag (${releaseVersion}) already exists!`)
          } catch (err) {
            octokitInstance.createRelease({
              tag: releaseVersion,
              message: releaseVersion,
              sha: releaseBranch.data.object.sha,
              prerelease: false
            })
          }
        }
      })
    )
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

run()
