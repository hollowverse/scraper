#! /usr/bin/env node
import * as program from 'commander';
import * as path from 'path';
import * as ProgressBar from 'progress';
import { downloadBatch } from '../lib/downloadBatch';
import { readDir, readJsonFile, writeFile } from '../lib/helpers';

// tslint:disable no-console

const defaults = {
  base: 'https://static.hollowverse.com',
  concurrency: 3,
};

type Path = {
  post_name: string;
};

program
  .description(
    'Download pages of the website, reading URL paths from a JSON file',
  )
  .option(
    '-p --posts <paths>',
    'The path to the JSON file containing an array of URL paths to download',
  )
  .option(
    '-o --output <output>',
    'The path to the folder where the downloaded HTML files should be saved.',
  )
  .option(
    '-b --base [base]',
    `The website domain name to download from. Defaults to ${defaults.base}`,
  )
  .option('-d --dry', 'Dry run (do not write files to disk).')
  .option(
    '-f --force',
    'Re-download and overwrite files that already exist in the output folder.',
  )
  .option(
    '-c --concurrency [concurrency]',
    'The maximum number of pages that should be downloaded at the same time. ' +
      `Defaults to ${defaults.concurrency}`,
  );

program.parse(process.argv);

async function main({
  posts,
  output,
  force,
  dry,
  base = defaults.base,
  concurrency = defaults.concurrency,
}: Record<string, any>) {
  const postNames = await readJsonFile<Path[]>(posts);
  let scheduledPaths = postNames.map(p => p.post_name);
  console.log(`${scheduledPaths.length} posts found.`);

  if (!force) {
    const alreadyDownloaded = new Set(await readDir(output));
    console.log(`${alreadyDownloaded.size} already downloaded.`);
    scheduledPaths = scheduledPaths.filter(
      postName => !alreadyDownloaded.has(`${postName}.html`),
    );
  }

  const progressBar = new ProgressBar(':bar [:percent] :path', {
    width: 25,
    total: scheduledPaths.length,
  });

  const downloadedUrls = await downloadBatch({
    paths: scheduledPaths,
    base,
    concurrency: Number(concurrency),
    async onPageDownloaded(html, urlPath, next) {
      if (!dry) {
        await writeFile(path.join(output, `${urlPath}.html`), html);
      }
      progressBar.tick({ path: next });
    },
  });

  console.log(
    `${downloadedUrls.length} URLs downloaded${
      !dry ? ' and written to disk' : ''
    }.`,
  );
}

main(program).catch(error => {
  console.error(`Failed to download some pages: ${error.message}`);
  process.exit(1);
});
