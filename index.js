const dotenv = require('dotenv')
dotenv.config()
const fs = require('fs')
const path = require('path')
const puppeteer = require('puppeteer')
const axios = require('axios')

const LINKS_JSON_PATH = path.join('./', 'links.json')
const IS_PROD = process.env.IS_PROD === 'true'
const BLOCK_SLACK_MSG = process.env.BLOCK_SLACK_MSG === 'true'
const ZIP_CODE = process.env.ZIP_CODE

const LOOP_WAIT = IS_PROD ? 1000 * 60 * 15 : 1000 * 20
const WAIT_TIME = IS_PROD ? 15000 : 3000
const HEADLESS = true
const VIEWPORT = { width: 1280, height: 800 }

const start = async () => {
  console.log('start', new Date().toLocaleString())

  await sleuthCarGurus()
  await sleuthCarfax()

  console.log(`Waiting ${msToMinSec(LOOP_WAIT)} until looping start...`)

  setTimeout(() => {
    start()
  }, LOOP_WAIT)
}

const msToMinSec = (ms) => {
  let minutes = Math.floor(ms / 60000)
  let seconds = ((ms % 60000) / 1000).toFixed(0)
  return minutes + ':' + (seconds < 10 ? '0' : '') + seconds
}

const sendSlackMsg = (msg) => {
  if (BLOCK_SLACK_MSG) {
    return console.log('Blocked slack msg')
  }

  console.log(`slack: ${msg}`)

  axios.post(process.env.SLACK_WEBHOOK, { text: msg }).catch((err) => {
    console.log('Error while posting to slack')
    console.error(err)
  })
}

// since perf isn't an issue, we just read file each time
// to keep logic super simple
const handleLink = async (link) => {
  let raw = fs.readFileSync(LINKS_JSON_PATH)
  let savedLinks = JSON.parse(raw)

  // is this a new link
  if (savedLinks.includes(link)) return

  // its new, alert and save
  console.log(`! New Link: ${link}`)
  sendSlackMsg(link)

  savedLinks.push(link)
  fs.writeFileSync(LINKS_JSON_PATH, JSON.stringify(savedLinks))
}

const handleLinks = async (source, links) => {
  console.log(`-> ${source}: Found ${links.length} links`)

  for (let i = 0; i < links.length; i++) {
    await handleLink(links[i])
  }
}

const sleuthCarfax = async () => {
  let url = 'https://www.carfax.com/Used-Honda-Element_w310'

  const browser = await puppeteer.launch({ headless: HEADLESS })
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  await page.goto(url)
  await page.waitForTimeout(WAIT_TIME)

  await page.type('input[name="zip"]', ZIP_CODE)
  await page.waitForTimeout(WAIT_TIME)
  await page.click('#make-model-form-submit')
  await page.waitForTimeout(WAIT_TIME)

  await page.select('select[name="radius"]', '500')
  await page.waitForTimeout(WAIT_TIME)
  await page.click('#make-model-form-submit')
  await page.waitForTimeout(WAIT_TIME)

  // click orange
  await page.evaluate(() =>
    document.querySelector('input[name="Orange"]').click()
  )
  await page.waitForTimeout(WAIT_TIME)

  let links = await page.evaluate(() => {
    let aTags = document.querySelectorAll('a')
    let l = []
    for (let i = 0; i < aTags.length; i++) {
      let a = aTags[i]
      if (a.href) {
        if (a.href.toLowerCase().includes('/vehicle/')) {
          l.push(a.href)
        }
      }
    }

    return l
  })

  await browser.close()

  await handleLinks('Carfax', links)
}

const sleuthCarGurus = async () => {
  let url = `https://www.cargurus.com/Cars/inventorylisting/viewDetailsFilterViewInventoryListing.action?zip=${ZIP_CODE}&showNegotiable=true&sortDir=ASC&sourceContext=untrackedExternal_false_0&distance=500&sortType=MILEAGE&entitySelectingHelper.selectedEntity=d590`

  const browser = await puppeteer.launch({ headless: HEADLESS })
  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)
  await page.goto(url)
  await page.waitForTimeout(WAIT_TIME)

  await page.evaluate(() => document.querySelector('#COLOR-ORANGE').click())

  await page.waitForTimeout(WAIT_TIME)

  let links = await page.evaluate(() => {
    let aTags = document.querySelectorAll('a[data-cg-ft="car-blade-link"]')
    let l = []
    for (let i = 0; i < aTags.length; i++) {
      l.push(aTags[i].href)
    }
    return l
  })

  await browser.close()

  await handleLinks('CarGurus', links)
}

start()
