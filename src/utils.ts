/* eslint-disable */

import {Api} from '@octokit/plugin-rest-endpoint-methods/dist-types/types'
import {PaginateInterface} from '@octokit/plugin-paginate-rest'
import {Octokit} from '@octokit/core'

type OctokitInstance = Octokit &
  Api & {
    paginate: PaginateInterface
  }

const owner = 'skedify'

export function createOctokitInstance({octokit, repo}: {octokit: OctokitInstance; repo: string}) {
  function getTagOrBranch(ref: string) {
    return octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref
    })
  }

  function getTag(tagName: string) {
    return getTagOrBranch(`tags/${tagName}`)
  }

  function getBranch(branchName: string) {
    return getTagOrBranch(`heads/${branchName}`)
  }

  async function createBranch({sha, branchName}: {sha: string; branchName: string}) {
    return octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha
    })
  }

  async function createTag({tag, message, sha}: {tag: string; message: string; sha: string}) {
    console.log('creating tag object...')

    const tagObject = await octokit.request('POST /repos/{owner}/{repo}/git/tags', {
      owner,
      repo,
      tag,
      message,
      object: sha,
      type: 'commit'
    })

    console.log('creating tag...')
    // create actual git tag with tagObject.
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/tags/${tagObject.data.tag}`,
      sha: tagObject.data.sha
    })

    return tagObject.data.tag
  }

  async function createRelease({
    tag,
    message = tag,
    sha,
    prerelease
  }: {
    tag: string
    message?: string
    sha: string
    prerelease: boolean
  }) {
    const tagRef = `tags/${tag}`

    const tagName = await createTag({tag: tagRef, message, sha})

    console.log('creating release...')
    // create release with tag
    await octokit.request('POST /repos/{owner}/{repo}/releases', {
      owner,
      repo,
      tag_name: tagName,
      prerelease
    })
  }

  return {
    getTag,
    getBranch,
    createRelease,
    createBranch
  }
}
