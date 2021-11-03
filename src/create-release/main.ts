/* eslint-disable */
import * as core from '@actions/core'
import * as github from '@actions/github'
import {OctokitResponse} from '@octokit/types'

const repos = [{repo: 'github-workflows', mainBranch: 'develop'}]
// const repos = [{repo: 'frontend-mono', mainBranch: 'develop'}]
const owner = 'skedify'

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

    // const context = github.context
    const octokit = github.getOctokit(GITHUB_TOKEN)

    const finalizeRelease = finalizeReleaseInput === 'Y'

    const releaseBranchRef = `heads/release/${releaseVersion}`

    await Promise.all(
      repos.map(async ({repo, mainBranch}) => {
        const throwError = getPrefixedThrow(repo)

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

        try {
          //check branch
          console.log('Checking branch...')
          releaseBranch = await octokit.request(
            'GET /repos/{owner}/{repo}/git/ref/{ref}',
            {
              owner,
              repo,
              ref: releaseBranchRef
            }
          )
        } catch (err) {
          // branch does not exist
          // create branch
          console.log('Branch not found')
          if (finalizeRelease)
            throwError(
              `Trying to finalize ${releaseVersion} while the release branch doesn't exist.`
            )

          console.log('Getting main branch...')

          const main = await octokit.request(
            'GET /repos/{owner}/{repo}/git/ref/{ref}',
            {
              owner,
              repo,
              ref: `heads/${mainBranch}`
            }
          )

          const {sha} = main.data.object

          console.log('Creating release branch...')

          releaseBranch = await octokit.request(
            'POST /repos/{owner}/{repo}/git/refs',
            {
              owner,
              repo,
              ref: `refs/${releaseBranchRef}`,
              sha
            }
          )
        }

        if (finalizeRelease) {
          const latestSha = releaseBranch.data.object.sha
          const stableReleaseTag = `${releaseVersion}`

          try {
            console.log('Checking release tag: ', stableReleaseTag)

            await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
              owner,
              repo,
              ref: `tags/${stableReleaseTag}`
            })
            console.log('Tag already exists!')
            throwError(`Release tag (${stableReleaseTag}) already exists!`)
          } catch (err) {
            console.log('creating tag object...')

            const tagObject = await octokit.request(
              'POST /repos/{owner}/{repo}/git/tags',
              {
                owner,
                repo,
                tag: stableReleaseTag,
                message: stableReleaseTag,
                object: latestSha,
                type: 'commit'
              }
            )

            console.log('creating tag...')
            // create actual git tag with tagObject.
            await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
              owner,
              repo,
              ref: `refs/tags/${tagObject.data.tag}`,
              sha: tagObject.data.sha
            })

            console.log('creating release...')
            // create release with tag
            await octokit.request('POST /repos/{owner}/{repo}/releases', {
              owner,
              repo,
              tag_name: tagObject.data.tag
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
