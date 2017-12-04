#! /usr/bin/env node
import * as program from 'commander';
import * as ProgressBar from 'progress';
import * as path from 'path';
import { scrapeHtml, Result } from '../lib/scrape';
import {
  readDir,
  glob,
  writeFile,
  hasKey,
  removeFile,
  readFile,
} from '../lib/helpers';
import { getWikipediaInfo, WikipediaData } from '../lib/getWikipediaInfo';
import { isEmpty } from 'lodash';
import { processBatch } from '../lib/processBatch';

// tslint:disable no-console

const defaults = {
  concurrency: 3,
  pattern: '*.html',
};

program
  .description('Scrape downloaded website pages')
  .option(
    '-p --pattern [pattern]',
    `A glob pattern of HTML files to scrape, must be wrapped in single quotes. Defaults to '${
      defaults.pattern
    }'`,
  )
  .option(
    '-i --input <input>',
    'The path to the directory containing the downloaded HTML files',
  )
  .option(
    '--no-wikipedia',
    'Do not add corresponding Wikipedia page URL to results',
  )
  .option(
    '--no-remove',
    'Do not remove people not found on Wikipedia (has no effect with --dry, conflicts with --no-wikipedia)',
  )
  .option(
    '-o --output <output>',
    'The path where to scraping results should be saved',
  )
  .option(
    '-f --force',
    'Re-scrape and overwrite files that already exist in the output folder',
  )
  .option('-d --dry', 'Dry run (do not write files to disk)')
  .option(
    '-c --concurrency [concurrency]',
    'The maximum number of pages that should be scraped at the same time. ' +
      `Defaults to ${defaults.concurrency}`,
  );

program.parse(process.argv);

export type ResultWithWikipediaData = Result & {
  wikipediaData?: Partial<WikipediaData>;
};

// tslint:disable-next-line:max-func-body-length
async function main({
  pattern = defaults.pattern,
  input,
  output,
  force,
  wikipedia,
  remove,
  dry,
  concurrency = defaults.concurrency,
}: Record<string, any>) {
  const files = await glob(pattern, { cwd: input, matchBase: false });
  let scheduledFiles = files;

  if (!force) {
    let alreadyScraped: Set<string>;
    try {
      alreadyScraped = new Set(await readDir(output));
    } catch (e) {
      alreadyScraped = new Set();
    }

    const filteredScheduledFiles = scheduledFiles.filter(
      file => !alreadyScraped.has(file.replace(/\.html?$/, '.json')),
    );

    if (scheduledFiles.length > filteredScheduledFiles.length) {
      scheduledFiles = filteredScheduledFiles;
      console.log(
        `Skipping scraping of ${alreadyScraped.size} (already scraped).`,
      );
      console.log('Pass --force to force scraping of those pages.');
    }
  }

  const progressBar = new ProgressBar(':bar [:percent] :page', {
    width: 25,
    total: scheduledFiles.length,
  });

  const results = await processBatch<string, ResultWithWikipediaData>({
    tasks: scheduledFiles.map(file => path.join(input, file)),
    concurrency: Number(concurrency),
    processTask: async file => {
      const html = await readFile(file, 'utf8');

      let result;
      result = await scrapeHtml(html);
      if (wikipedia) {
        const wikipediaData = await getWikipediaInfo(result);

        result = {
          ...result,
          wikipediaData,
        };
      }

      return result;
    },
    async onTaskCompleted(result, inputFile) {
      const outputFile = path.join(
        output,
        path.basename(inputFile).replace(/\.html?$/, '.json'),
      );
      if (!dry) {
        if (
          remove &&
          hasKey<WikipediaData, 'wikipediaData'>(result, 'wikipediaData') &&
          isEmpty(result.wikipediaData)
        ) {
          await removeFile(outputFile).catch(() => null);
        } else {
          await writeFile(outputFile, JSON.stringify(result, undefined, 2));
        }
      }
      progressBar.tick({ page: inputFile });
    },
  });

  console.log(
    dry
      ? `${scheduledFiles.length} scraped.`
      : `${scheduledFiles.length} scraped and written to disk.`,
  );

  const missingData = results.filter(result => {
    if (hasKey<WikipediaData, 'wikipediaData'>(result, 'wikipediaData')) {
      return isEmpty(result.wikipediaData);
    }

    return false;
  });

  if (missingData.length) {
    console.log(
      `Could not find matching Wikipedia pages for ${
        missingData.length
      } people:`,
    );

    missingData.forEach(({ name }) => {
      console.log(`  * ${name}`);
    });

    if (!dry && remove) {
      console.log('Those files were removed.');
    }
  }

  const missingImages = results.filter(result => {
    if (hasKey<WikipediaData, 'wikipediaData'>(result, 'wikipediaData')) {
      return (
        !isEmpty(result.wikipediaData) &&
        result.wikipediaData.isDisambiguation === false &&
        result.wikipediaData.thumbnail === undefined
      );
    }

    return false;
  });

  if (missingImages.length) {
    console.log(
      `The following ${missingImages.length} people were found on Wikipedia, ` +
        'but without matching thumbnail images:',
    );

    missingImages.forEach(({ name }) => {
      console.log(`  * ${name}`);
    });
  }

  const areDisambiguationPages = results.filter(result => {
    if (hasKey<WikipediaData, 'wikipediaData'>(result, 'wikipediaData')) {
      return (
        !isEmpty(result.wikipediaData) &&
        result.wikipediaData.isDisambiguation === true
      );
    }

    return false;
  });

  if (areDisambiguationPages.length) {
    console.log(
      'Wikipedia returned disambiguation pages for ' +
        `the following ${areDisambiguationPages.length} people:`,
    );

    areDisambiguationPages.forEach(result => {
      if (hasKey<WikipediaData, 'wikipediaData'>(result, 'wikipediaData')) {
        console.log(`  * ${result.name} (${result.wikipediaData.url})`);
      }
    });
  }
}

main(program).catch(error => {
  console.error(`Failed to scrape some pages: ${error.message}`);
  process.exit(1);
});
