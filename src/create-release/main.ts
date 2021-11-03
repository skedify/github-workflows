/* eslint-disable */
import * as core from '@actions/core'
import * as github from '@actions/github'
import {OctokitResponse} from '@octokit/types'

const repos = [{repo: 'github-workflows', mainBranch: 'develop'}]
// const repos = [{repo: 'frontend-mono', mainBranch: 'develop'}]
const owner = 'skedify'

async function run(): Promise<void> {
  try {
    const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN')
    const releaseVersion = core.getInput('RELEASE_VERSION') || '2021-Q5'
    const finalizeReleaseInput = core.getInput('FINALISE_RELEASE') || 'N'

    // const context = github.context
    const octokit = github.getOctokit(GITHUB_TOKEN)

    const finalizeRelease = finalizeReleaseInput === 'Y'

    const releaseBranchRef = `refs/heads/release/${releaseVersion}`

    await Promise.all(
      repos.map(async ({repo, mainBranch}) => {
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
          const main = await octokit.request(
            'GET /repos/{owner}/{repo}/git/ref/{ref}',
            {
              owner,
              repo,
              ref: `refs/heads/${mainBranch}`
            }
          )

          const {sha} = main.data.object

          releaseBranch = await octokit.request(
            'POST /repos/{owner}/{repo}/git/refs',
            {
              owner,
              repo,
              ref: releaseBranchRef,
              sha
            }
          )
        }

        if (finalizeRelease) {
          const latestSha = releaseBranch.data.object.sha
          const stableReleaseTag = `${releaseVersion}-stable`

          try {
            await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
              owner,
              repo,
              ref: stableReleaseTag
            })
            // TODO: Tag already exists, error out.
          } catch (err) {
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

            // create actual git tag with tagObject.
            await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
              owner,
              repo,
              ref: `tags/${tagObject.data.tag}`,
              sha: tagObject.data.sha
            })

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
