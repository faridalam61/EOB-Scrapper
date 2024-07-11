const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { v4: uuidv4 } = require('uuid');

// Use the stealth plugin
puppeteer.use(StealthPlugin());

function getRandomExpirationDate() {
  const currentDate = new Date();
  const minDate = new Date(currentDate.setMonth(currentDate.getMonth() + 3));
  const maxDate = new Date(currentDate.setMonth(currentDate.getMonth() + 2));
  const randomDate = new Date(minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime()));
  
  // Format date in MM/DD/YYYY format
  const month = String(randomDate.getMonth() + 1).padStart(2, '0');
  const day = String(randomDate.getDate()).padStart(2, '0');
  const year = randomDate.getFullYear();

  return `${month}/${day}/${year}`;
}

async function scrapeJobs() {
  const numberOfPagesToScrape = 3; // Number of times to click the next page button
  let currentPage = 1;

  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  const url = `https://www.indeed.com/jobs?q=software+developer&l=San+Francisco%2C+CA`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

  async function scrapeJobDetails() {
    const jobDetails = [];

    while (currentPage <= numberOfPagesToScrape) {
      // Check if 'cb-lb' class appears
      const cbLbButton = await page.$('.cb-lb');
      if (cbLbButton) {
        console.log('Captcha detected, stopping the scraper.');
        break; // Exit the loop if captcha is detected
      }

      await page.waitForSelector('.resultContent');
      const resultContents = await page.$$('.resultContent');

      for (const resultContent of resultContents) {
        try {
          const jobUrl = await resultContent.$eval('.jobTitle > a', el => el.href).catch(() => 'pending');
          const thirdPartyApplyUrl = await resultContent.$eval('.jobTitle > a', el => el.href).catch(() => 'pending');

          await resultContent.click();
          await page.waitForSelector('.jobsearch-JobInfoHeader-title', { timeout: 60000 });

          const jobTitle = await page.$eval('.jobsearch-JobInfoHeader-title', el => {
            let titleText = el.innerText.trim();
            const excludedTextElements = el.querySelectorAll('.css-1b6omqv.esbq1260');
            excludedTextElements.forEach(excludedEl => {
              titleText = titleText.replace(excludedEl.innerText.trim(), '');
            });
            return titleText.trim();
          }).catch(() => 'pending');

          const location = await page.$eval('[data-testid="jobsearch-JobInfoHeader-companyLocation"]', el => el.innerText.trim()).catch(() => 'pending');
          const salaryInfo = await page.$eval('#salaryInfoAndJobType', el => {
            const spans = el.querySelectorAll('span');
            const salary = spans.length > 0 ? spans[0].innerText.trim() : 'pending';
            const jobType = spans.length > 1 ? spans[1].innerText.trim() : 'unknown';
            return { salary, jobType };
          }).catch(() => ({ salary: 'pending', jobType: 'unknown' }));

          const benefit = await page.$eval('#benefits', el => {
            const textContent = el.innerText.trim();
            return textContent ? textContent : 'unknown';
          }).catch(() => 'unknown');

          const description = await page.$eval('#jobDescriptionText', el => el.innerText.trim()).catch(() => 'pending');
          const jobShift = await page.$eval('.js-match-insights-provider-g6kqeb.ecydgvn0', el => {
            const divs = el.querySelectorAll('div');
            if (divs.length > 0) {
              return Array.from(divs).map(div => div.innerText.trim()).join(', ');
            }
            return 'unknown';
          }).catch(() => 'unknown');

          const companyUrl = await page.$eval('.css-1saizt3.e1wnkr790 > a', el => el.href).catch(() => 'pending');
          const companyName = await page.$eval('.css-1saizt3.e1wnkr790 > a', el => el.innerText.trim()).catch(() => 'pending');
          const averageRating = await page.$eval('[data-testid="inlineHeader-companyName"] .css-ppxtlp.e1wnkr790', el => el.innerText.trim()).catch(() => 'pending');

          let review = 'pending';
          let numberOfJobs = 'pending';
          if (companyUrl !== 'pending') {
            const companyPage = await browser.newPage();
            await companyPage.goto(companyUrl, { waitUntil: 'networkidle2', timeout: 60000 });

            // Extract review
            review = await companyPage.$eval('[data-testid="reviews-tab"] .css-104u4ae.eu4oa1w0', el => el.innerText.trim()).catch(() => 'pending');
            // Extract number of jobs
            numberOfJobs = await companyPage.$eval('[data-testid="jobs-tab"] .css-104u4ae.eu4oa1w0', el => el.innerText.trim()).catch(() => 'pending');
            
            await companyPage.close();
          }

          const jobId = uuidv4();
          const expiresAt = getRandomExpirationDate();

          jobDetails.push({
            jobId,
            title: jobTitle,
            job_url: jobUrl,
            branch: location,
            company: companyName,
            company_url: companyUrl,
            review,
            description,
            type: salaryInfo.jobType,
            salary: salaryInfo.salary,
            shift: jobShift,
            benefit,
            category: 'pending',
            subcategory: 'pending',
            expire_at: expiresAt,
            is_claimed: false,
            average_rating: averageRating,
            number_of_jobs: numberOfJobs,
            third_party_apply_url: thirdPartyApplyUrl
          });

          await page.goBack({ waitUntil: 'networkidle2', timeout: 60000 });
        } catch (error) {
          console.error('Error during scraping job details:', error);
        }
      }

      // Click on the next page
      try {
        const nextPageButtons = await page.$$('.css-227srf.eu4oa1w0');
        const lastNextPageButton = nextPageButtons[nextPageButtons.length - 1];
        await lastNextPageButton.click();
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        currentPage++;
      } catch (error) {
        console.error('No more pages to scrape or unable to find the next button:', error);
        break;
      }
    }

    return jobDetails;
  }

  const jobDetails = await scrapeJobDetails();
  console.log(jobDetails);

  await saveJobsToCsv(jobDetails, 'jobs.csv');

  await browser.close();
}

async function saveJobsToCsv(jobs, filePath) {
  const csvWriter = createCsvWriter({
    path: `jobs/${filePath}`,
    header: [
      { id: 'jobId', title: 'jobId' },
      { id: 'title', title: 'title' },
      { id: 'job_url', title: 'job_url' },
      { id: 'branch', title: 'branch' },
      { id: 'company', title: 'company' },
      { id: 'company_url', title: 'company_url' },
      { id: 'review', title: 'review' },
      { id: 'description', title: 'description' },
      { id: 'type', title: 'type' },
      { id: 'salary', title: 'salary' },
      { id: 'shift', title: 'shift' },
      { id: 'benefit', title: 'benefit' },
      { id: 'category', title: 'category' },
      { id: 'subcategory', title: 'subcategory' },
      { id: 'expire_at', title: 'expire_at' },
      { id: 'is_claimed', title: 'is_claimed' },
      { id: 'average_rating', title: 'average_rating' },
      { id: 'number_of_jobs', title: 'number_of_jobs' },
      { id: 'third_party_apply_url', title: 'third_party_apply_url' },
    ],
  });

  await csvWriter.writeRecords(jobs);
}

(async () => {
  await scrapeJobs();
})();
