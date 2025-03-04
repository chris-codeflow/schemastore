/// <binding AfterBuild='build' />
const addFormats = require('ajv-formats')
const ajvFormatsDraft2019 = require('ajv-formats-draft2019')
const AjvDraft04 = require('ajv-draft-04')
const AjvDraft06And07 = require('ajv')
const Ajv2019 = require('ajv/dist/2019')
const Ajv2020 = require('ajv/dist/2020')
const pt = require('path')
const fs = require('fs')
const schemaDir = 'schemas/json'
const testPositiveDir = 'test'
const testNegativeDir = 'negative_test'
const urlSchemaStore = 'https://json.schemastore.org'
const catalog = require('./api/json/catalog.json')
const schemaV4JSON = require(pt.resolve('.', schemaDir, 'schema-draft-v4.json'))
const schemaValidation = require('./schema-validation.json')
const schemasToBeTested = fs.readdirSync(schemaDir)
const foldersPositiveTest = fs.readdirSync(testPositiveDir)
const foldersNegativeTest = fs.readdirSync(testNegativeDir)
const countSchemasType = [
  { schemaName: '2020-12', schemaStr: 'json-schema.org/draft/2020-12/schema', totalCount: 0, active: true },
  { schemaName: '2019-09', schemaStr: 'json-schema.org/draft/2019-09/schema', totalCount: 0, active: true },
  { schemaName: 'draft-07', schemaStr: 'json-schema.org/draft-07/schema', totalCount: 0, active: true },
  { schemaName: 'draft-06', schemaStr: 'json-schema.org/draft-06/schema', totalCount: 0, active: true },
  { schemaName: 'draft-04', schemaStr: 'json-schema.org/draft-04/schema', totalCount: 0, active: true },
  { schemaName: 'draft-03', schemaStr: 'json-schema.org/draft-03/schema', totalCount: 0, active: false },
  { schemaName: 'draft without version', schemaStr: 'json-schema.org/schema', totalCount: 0, active: false }
]

module.exports = function (grunt) {
  'use strict'

  grunt.file.preserveBOM = false
  grunt.initConfig({

    tv4: {
      options: {
        schemas: {
          'http://json-schema.org/draft-04/schema#': grunt.file.readJSON('schemas/json/schema-draft-v4.json'),
          'https://json.schemastore.org/jsonld': grunt.file.readJSON('schemas/json/jsonld.json'),
          'https://json.schemastore.org/schema-org-thing': grunt.file.readJSON('schemas/json/schema-org-thing.json'),
          'http://json.schemastore.org/xunit.runner.schema': grunt.file.readJSON('schemas/json/xunit.runner.schema.json'),
          'https://json.schemastore.org/feed-1': grunt.file.readJSON('schemas/json/feed-1.json')
        }
      }
    }
  })

  function skipThisFileName (name) {
    // This macOS file must always be ignored.
    return name === '.DS_Store'
  }

  function getUrlFromCatalog (catalogUrl) {
    for (const schema of catalog.schemas) {
      catalogUrl(schema.url)
      const versions = schema.versions
      if (versions) {
        for (const prop in versions) {
          catalogUrl(versions[prop])
        }
      }
    }
  }

  async function remoteSchemaFile (schema1PassScan, showLog = true) {
    const got = require('got')
    const schemas = catalog.schemas

    for (const { url } of schemas) {
      if (url.startsWith(urlSchemaStore)) {
        // Skip local schema
        continue
      }
      try {
        const response = await got(url)
        if (response.statusCode === 200) {
          const parsed = new URL(url)
          const callbackParameter = {
            jsonName: pt.basename(parsed.pathname),
            rawFile: response.rawBody,
            urlOrFilePath: url,
            schemaScan: true
          }
          schema1PassScan(callbackParameter)
          if (showLog) {
            grunt.log.ok(url)
          }
        } else {
          if (showLog) {
            grunt.log.error(url, response.statusCode)
          }
        }
      } catch (error) {
        if (showLog) {
          grunt.log.writeln('')
          grunt.log.error(url, error.name, error.message)
          grunt.log.writeln('')
        }
      }
    }
  }

  function localSchemaFileAndTestFile (
    {
      schema_1_PassScan: schema1PassScan = undefined,
      schema_1_PassScanDone: schema1PassScanDone = undefined,
      schema_2_PassScan: schema2PassScan = undefined,
      positiveTest_1_PassScan: positiveTest1PassScan = undefined,
      positiveTest_1_PassScanDone = undefined,
      negativeTest_1_PassScan: negativeTest1PassScan = undefined,
      negativeTest_1_PassScanDone = undefined
    },
    {
      fullScanAllFiles = false,
      tv4OnlyMode = false,
      logTestFolder = true
    } = {}) {
    let callbackParameter = {
      jsonName: undefined,
      rawFile: undefined,
      urlOrFilePath: undefined,
      schemaScan: true
    }

    /**
     * @summary Check if the present json schema file must be tested or not
     * @param {string} jsonFilename
     * @returns {boolean}
     */
    const canThisTestBeRun = (jsonFilename) => {
      if (schemaValidation.skiptest.includes(jsonFilename)) {
        return false // This test can be never process
      }
      if (fullScanAllFiles) {
        return true
      } else {
        // Schema must be run for tv4 or AJV validator
        // tv4OnlyMode is only set true when it is called by tv4 validator
        // If schema is present in "tv4test" list then it can only be run if tv4OnlyMode = true
        // If schema is NOT present in "tv4test" list then it can only be run if tv4OnlyMode = false
        return schemaValidation.tv4test.includes(jsonFilename) ? tv4OnlyMode : !tv4OnlyMode
      }
    }

    const runTestFolder = (testDir, folderName, schemaPassScan, testPassScan, testPassScanDone) => {
      // We only care about test directory.
      if (!fs.lstatSync(pt.join(testDir, folderName)).isDirectory()) {
        return
      }

      if (skipThisFileName(folderName)) {
        return
      }

      if (canThisTestBeRun(`${folderName}.json`) === false) {
        return
      }

      if (logTestFolder) {
        grunt.log.writeln('')
        grunt.log.writeln(`test folder   : ${folderName}`)
      }

      const filesInsideOneTestFolder = fs.readdirSync(pt.join(testDir, folderName)).map(
        // Must create a full path
        (fileName) => pt.join(testDir, folderName, fileName)
      )

      if (!filesInsideOneTestFolder.length) {
        throw new Error(`Found folder with no test files: ${folderName}`)
      }

      const schemaFileWithPath = pt.join(schemaDir, `${folderName}.json`)
      if (schemaPassScan) {
        callbackParameter = {
          // Return the real Raw file for BOM file test rejection
          rawFile: fs.readFileSync(schemaFileWithPath),
          jsonName: pt.basename(schemaFileWithPath),
          urlOrFilePath: schemaFileWithPath,
          // This is a test folder scan process, not schema scan process
          schemaScan: false
        }
        schemaPassScan(callbackParameter)
      }

      if (testPassScan) {
        // Test file may have BOM. But this must be strip for the next process
        grunt.file.preserveBOM = false // Strip file from BOM
        filesInsideOneTestFolder.forEach(function (file) {
          // must ignore BOM in test
          callbackParameter = {
            rawFile: grunt.file.read(file),
            jsonName: pt.basename(file.toString()),
            urlOrFilePath: file,
            // This is a test folder scan process, not schema scan process
            schemaScan: false
          }
          testPassScan(callbackParameter)
        })
        if (testPassScanDone) {
          testPassScanDone()
        }
      }
    }

    if (tv4OnlyMode) {
      // tv4 already have it own console output take care of.
      logTestFolder = false
    }

    // Verify each schema file
    schemasToBeTested.forEach((schemaFileName) => {
      const schemaFullPathName = pt.join(schemaDir, schemaFileName)

      // If not a file, ignore and continue. We only care about files.
      if (!fs.lstatSync(schemaFullPathName).isFile()) {
        return
      }

      if (skipThisFileName(schemaFileName)) {
        return
      }

      if (canThisTestBeRun(schemaFileName) === false) {
        return
      }

      callbackParameter = {
        // Return the real Raw file for BOM file test rejection
        rawFile: fs.readFileSync(schemaFullPathName),
        jsonName: pt.basename(schemaFullPathName),
        urlOrFilePath: schemaFullPathName,
        // This is a schema file scan process, not test folder process
        schemaScan: true
      }
      if (schema1PassScan) {
        schema1PassScan(callbackParameter)
      }
      if (schema2PassScan) {
        schema2PassScan(callbackParameter)
      }
    })

    if (schema1PassScanDone) {
      schema1PassScanDone()
    }

    // Do not scan the test folder if there are no one to process the data
    if (positiveTest1PassScan) {
      // Now run all positive test in each test folder
      if (logTestFolder) {
        grunt.log.writeln()
        grunt.log.writeln('-------- Processing all the positive test folders')
      }
      foldersPositiveTest.forEach((folderName) => {
        runTestFolder(testPositiveDir, folderName, schema2PassScan, positiveTest1PassScan, positiveTest_1_PassScanDone)
      })
    }

    // Do not scan the test folder if there are no one to process the data
    //  and tv4 don't have negative test
    if (negativeTest1PassScan && (tv4OnlyMode === false)) {
      // Now run all negative test in each test folder
      if (logTestFolder) {
        grunt.log.writeln()
        grunt.log.writeln('-------- Processing all the negative test folders')
      }
      foldersNegativeTest.forEach((folderName) => {
        runTestFolder(testNegativeDir, folderName, schema2PassScan, negativeTest1PassScan, negativeTest_1_PassScanDone)
      })
    }
  }

  function testSchemaFileForBOM (callbackParameter) {
    // JSON schema file must not have any BOM type
    const buffer = callbackParameter.rawFile
    const bomTypes = [
      { name: 'UTF-8', signature: [0xEF, 0xBB, 0xBF] },
      { name: 'UTF-16 (BE)', signature: [0xFE, 0xFF] },
      { name: 'UTF-16 (LE)', signature: [0xFF, 0xFE] },
      { name: 'UTF-32 (BE)', signature: [0x00, 0x00, 0xFF, 0xFE] },
      { name: 'UTF-32 (LE)', signature: [0xFF, 0xFE, 0x00, 0x00] }
    ]

    for (const bom of bomTypes) {
      if (buffer.length >= bom.signature.length) {
        const bomFound = bom.signature.every((value, index) => buffer[index] === value)
        if (bomFound) {
          throw new Error(`Schema file must not have ${bom.name} BOM: ${callbackParameter.urlOrFilePath}`)
        }
      }
    }
  }

  function tv4 () {
    // tv4 validator can only process draft-04 schema
    // All unknown keyword used in draft-06 and newer are just ignored.
    // This is the correct implementation of the json schema specification.
    let schemaPath
    let schemaName
    const testSchemaPath = []
    let testListPath = []

    const processSchemaFile = (callbackParameter) => {
      if (callbackParameter.schemaScan === true) {
        // Must later be process it, all at once in processSchemaFileDone()
        testSchemaPath.push(callbackParameter.urlOrFilePath)
      } else {
        // This is a test scan. Copy schema path for the next test file process.
        schemaName = callbackParameter.jsonName
        schemaPath = callbackParameter.urlOrFilePath
        testListPath = []
      }
    }

    const processSchemaFileDone = () => {
      // Process the scan of all the schema files at once
      if (testSchemaPath.length === 0) {
        // tv4 task can never be empty. It will give error. Work around just rescan schema-catalog.json
        testSchemaPath.push(pt.resolve('.', schemaDir, 'schema-catalog.json'))
      }
      const valid = 'Schemas'
      grunt.config.set('tv4.' + valid, {
        options: {
          root: schemaV4JSON,
          banUnknown: false
        },
        src: [testSchemaPath]
      })
    }

    const processTestFile = (callbackParameter) => {
      // Add all the test list path of one test group together.
      //  this will be process later at processTestFileDone()
      testListPath.push(callbackParameter.urlOrFilePath)
    }

    const processTestFileDone = () => {
      // Process one test group 'in a folder' at once
      const valid = schemaName.replace(/\./g, '\\.')
      grunt.config.set('tv4.' + valid, {
        options: {
          root: grunt.file.readJSON(schemaPath),
          banUnknown: false
        },
        src: [testListPath]
      })
    }

    return {
      testSchemaFile: processSchemaFile,
      testSchemaFileDone: processSchemaFileDone,
      testTestFile: processTestFile,
      testTestFileDone: processTestFileDone
    }
  }

  /**
   * There are multiple AJV version for each $schema version.
   * return the correct AJV instance
   * @param {string} schemaName
   * @param {string[]} unknownFormatsList
   * @returns {Object}
   */
  function factoryAJV (schemaName, unknownFormatsList = []) {
    // some AJV default setting are [true, false or log]
    // Some option are default: 'log'
    // 'log' will generate a lot of noise in the build log. So make it true or false.
    // Hiding the issue log also does not solve anything.
    // These option items that are not strict must be reduces in the future.
    /** @type {Object} */
    const ajvOptions = {
      strictTypes: false, // recommended : true
      strictTuples: false, // recommended : true
      allowMatchingProperties: true // recommended : false
    }

    let ajvSelected
    // There are multiple AJV version for each $schema version.
    // Create the correct one.
    switch (schemaName) {
      case 'draft-04':
        ajvSelected = new AjvDraft04(ajvOptions)
        break
      case 'draft-06':
      case 'draft-07':
        ajvSelected = new AjvDraft06And07(ajvOptions)
        if (schemaName === 'draft-06') {
          ajvSelected.addMetaSchema(require('ajv/dist/refs/json-schema-draft-06.json'))
        } else {
          // 'draft-07' have additional format
          ajvFormatsDraft2019(ajvSelected)
        }
        break
      case '2019-09':
        ajvSelected = new Ajv2019(ajvOptions)
        ajvFormatsDraft2019(ajvSelected)
        break
      case '2020-12':
        ajvSelected = new Ajv2020(ajvOptions)
        ajvFormatsDraft2019(ajvSelected)
        break
      default:
        ajvSelected = new AjvDraft04(ajvOptions)
    }

    // addFormats() and addFormat() to the latest AJV version
    addFormats(ajvSelected)
    unknownFormatsList.forEach((x) => {
      ajvSelected.addFormat(x, true)
    })
    return ajvSelected
  }

  /**
   * Get the option items for this specific jsonName
   * @param {string} jsonName
   * @returns {
   * {unknownFormatsList: string[],
   * externalSchemaWithPathList: string[],
   * unknownKeywordsList: string[]}
   * }
   */
  function getOption (jsonName) {
    const options = schemaValidation.options.find(
      item => jsonName in item
    )?.[jsonName]

    // collect the unknownFormat list
    const unknownFormatsList = options?.unknownFormat ?? []

    // collect the unknownKeywords list
    const unknownKeywordsList = options?.unknownKeywords ?? []

    // collect the externalSchema list
    const externalSchemaList = options?.externalSchema ?? []
    const externalSchemaWithPathList = externalSchemaList?.map((schemaFileName) => {
      return pt.resolve('.', schemaDir, schemaFileName)
    })

    // return all the collected values
    return {
      unknownFormatsList,
      unknownKeywordsList,
      externalSchemaWithPathList
    }
  }

  function ajv () {
    const schemaVersion = showSchemaVersions()
    const textCompile = 'compile    | '
    const textPassSchema = 'pass schema          | '
    const textPositivePassTest = 'pass positive test   | '
    const textPositiveFailedTest = 'failed positive test | '
    const textNegativePassTest = 'pass negative test   | '
    const textNegativeFailedTest = 'failed negative test | '

    let validate
    let countSchema = 0

    const processSchemaFile = (callbackParameter) => {
      let ajvSelected

      // Get possible options define in schema-validation.json
      const {
        unknownFormatsList,
        unknownKeywordsList,
        externalSchemaWithPathList
      } = getOption(callbackParameter.jsonName)

      // Start validate the JSON schema
      let schemaJson
      let versionObj
      let schemaVersionStr = 'unknown'
      try {
        // select the correct AJV object for this schema
        schemaJson = JSON.parse(callbackParameter.rawFile)
        versionObj = schemaVersion.getObj(schemaJson)

        // Get the correct AJV version
        ajvSelected = factoryAJV(versionObj?.schemaName, unknownFormatsList)

        // AJV must ignore these keywords
        unknownKeywordsList?.forEach((x) => {
          ajvSelected.addKeyword(x)
        })

        // Add external schema to AJV
        externalSchemaWithPathList.forEach((x) => {
          ajvSelected.addSchema(require(x.toString()))
        })

        // What schema draft version is it?
        schemaVersionStr = versionObj ? versionObj.schemaName : 'unknown'

        // compile the schema
        validate = ajvSelected.compile(schemaJson)
      } catch (e) {
        grunt.log.error(`${textCompile}${callbackParameter.urlOrFilePath} (${schemaVersionStr})`)
        throw new Error(e)
      }
      countSchema++
      grunt.log.ok(`${textPassSchema}${callbackParameter.urlOrFilePath} (${schemaVersionStr})`)
    }

    const processTestFile = (callbackParameter, success, failure) => {
      let json
      try {
        json = JSON.parse(callbackParameter.rawFile)
      } catch (e) {
        grunt.log.error(`Error in parse test: ${callbackParameter.urlOrFilePath}`)
        throw new Error(e)
      }
      validate(json) ? success() : failure()
    }

    const processPositiveTestFile = (callbackParameter) => {
      processTestFile(callbackParameter,
        () => {
          grunt.log.ok(textPositivePassTest + callbackParameter.urlOrFilePath)
        },
        () => {
          const path = validate.errors[0].instancePath
          grunt.log.error(textPositiveFailedTest + callbackParameter.urlOrFilePath)
          grunt.log.error('(Schema file) keywordLocation: ' + validate.errors[0].schemaPath)
          grunt.log.error('(Test file) instanceLocation: ' + path)
          grunt.log.error('(Message) ' + validate.errors[0].message)
          throw new Error('Error in positive test.')
        }
      )
    }

    const processNegativeTestFile = (callbackParameter) => {
      processTestFile(callbackParameter,
        () => {
          grunt.log.error(textNegativeFailedTest + callbackParameter.urlOrFilePath)
          throw new Error('Negative test must always fail.')
        },
        () => {
          // must show log as single line
          const path = validate.errors[0].instancePath
          grunt.log.ok(textNegativePassTest +
                callbackParameter.urlOrFilePath +
                ' (Schema: ' +
                validate.errors[0].schemaPath +
                ') (Test: ' +
                path +
                ') (Message) ' + validate.errors[0].message
          )
        }
      )
    }

    const processSchemaFileDone = () => {
      grunt.log.writeln()
      grunt.log.writeln('Total schemas validated with AJV: ' + countSchema.toString())
      countSchema = 0
    }

    return {
      testSchemaFile: processSchemaFile,
      testSchemaFileDone: processSchemaFileDone,
      positiveTestFile: processPositiveTestFile,
      negativeTestFile: processNegativeTestFile
    }
  }

  grunt.registerTask('local_tv4_only_for_non_compliance_schema', 'Dynamically load local schema file for validation with /test/', function () {
    const x = tv4()
    localSchemaFileAndTestFile({
      schema_2_PassScan: x.testSchemaFile,
      schema_1_PassScanDone: x.testSchemaFileDone,
      positiveTest_1_PassScan: x.testTestFile,
      positiveTest_1_PassScanDone: x.testTestFileDone
    }, { tv4OnlyMode: true })
    // The tv4 task is actually run after this registerTask()
  })

  grunt.registerTask('local_ajv_test', 'Dynamically load local schema file for validation with /test/', function () {
    const x = ajv()
    localSchemaFileAndTestFile({
      schema_2_PassScan: x.testSchemaFile,
      positiveTest_1_PassScan: x.positiveTestFile,
      negativeTest_1_PassScan: x.negativeTestFile,
      schema_1_PassScanDone: x.testSchemaFileDone
    })
    grunt.log.writeln()
    grunt.log.ok('local schema passed')
  })

  grunt.registerTask('remote_ajv_test', 'Dynamically load external schema file for validation', async function () {
    const done = this.async()
    const x = ajv()
    await remoteSchemaFile(x.testSchemaFile)
    done()
  })

  grunt.registerTask('local_bom', 'Dynamically load local schema file for BOM validation', function () {
    let countScan = 0
    const x = (data) => {
      countScan++
      testSchemaFileForBOM(data)
    }
    localSchemaFileAndTestFile({ schema_1_PassScan: x }, { fullScanAllFiles: true })
    grunt.log.ok('no BOM file found in all schema files. Total files scan: ' + countScan)
  })

  grunt.registerTask('remote_bom', 'Dynamically load remote schema file for BOM validation', async function () {
    const done = this.async()
    await remoteSchemaFile(testSchemaFileForBOM, false)
    done()
  })

  grunt.registerTask('local_catalog', 'Catalog validation', function () {
    const catalogSchema = require(pt.resolve('.', schemaDir, 'schema-catalog.json'))
    const ajvInstance = factoryAJV('draft-04')
    if (ajvInstance.validate(catalogSchema, catalog)) {
      grunt.log.ok('catalog.json OK')
    } else {
      grunt.log.error('(Schema file) keywordLocation: ' + ajvInstance.errors[0].schemaPath)
      grunt.log.error('(Catalog file) instanceLocation: ' + ajvInstance.errors[0].instancePath)
      grunt.log.error('(message) instanceLocation: ' + ajvInstance.errors[0].message)
      throw new Error('"Catalog ERROR"')
    }
  })

  grunt.registerTask('local_find-duplicated-property-keys', 'Dynamically load local test file for validation', function () {
    const findDuplicatedPropertyKeys = require('find-duplicated-property-keys')
    let countScan = 0
    const findDuplicatedProperty = (callbackParameter) => {
      countScan++
      const result = findDuplicatedPropertyKeys(callbackParameter.rawFile)
      if (result.length > 0) {
        grunt.log.error('Duplicated key found in: ' + callbackParameter.urlOrFilePath)
        for (const issue of result) {
          grunt.log.error(issue.key + ' <= This duplicate key is found. occurrence :' + issue.occurrence.toString())
        }
        throw new Error('Error in test: find-duplicated-property-keys')
      }
    }
    localSchemaFileAndTestFile({ positiveTest_1_PassScan: findDuplicatedProperty }, { logTestFolder: false })
    grunt.log.ok('No duplicated property key found in test files. Total files scan: ' + countScan)
  })

  grunt.registerTask('local_url-present-in-catalog', 'local url must reference to a file', function () {
    const urlRecommendation = 'https://json.schemastore.org/<schemaName>.json'
    let countScan = 0

    getUrlFromCatalog(catalogUrl => {
      // URL that does not have "schemastore.org" is an external schema.
      if (!catalogUrl.includes('schemastore.org')) {
        return
      }
      countScan++
      // Check if local URL is a valid format with subdomain format.
      if (!catalogUrl.startsWith(urlSchemaStore)) {
        throw new Error(`Wrong: ${catalogUrl} Must be in this format: ${urlRecommendation}`)
      }
      // Check if local URL have .json extension
      const filenameMustBeAtThisUrlDepthPosition = 3
      const filename = catalogUrl.split('/')[filenameMustBeAtThisUrlDepthPosition]
      if (!filename?.endsWith('.json')) {
        throw new Error(`Wrong: ${catalogUrl} Missing ".json" extension. Must be in this format: ${urlRecommendation}`)
      }
      // Check if schema file exist or not.
      if (fs.existsSync(pt.resolve('.', schemaDir, filename)) === false) {
        throw new Error(`Schema file not found: ${filename} Catalog URL: ${catalogUrl}`)
      }
    })
    grunt.log.ok('All local url tested OK. Total: ' + countScan)
  })

  grunt.registerTask('local_schema-present-in-catalog-list', 'local schema must have a url reference in catalog list', function () {
    let countScan = 0
    const allCatalogLocalJsonFiles = []

    // Read all the JSON file name from catalog and add it to allCatalogLocalJsonFiles[]
    getUrlFromCatalog(catalogUrl => {
      // No need to validate the local URL correctness. It is al ready done in "local_url-present-in-catalog"
      // Only scan for local schema.
      if (catalogUrl.startsWith(urlSchemaStore)) {
        const filename = catalogUrl.split('/').pop()
        allCatalogLocalJsonFiles.push(filename)
      }
    })

    // Check if allCatalogLocalJsonFiles[] have the actual schema filename.
    const schemaFileCompare = (x) => {
      // skip testing if present in "missingcatalogurl"
      if (!schemaValidation.missingcatalogurl.includes(x.jsonName)) {
        countScan++
        const found = allCatalogLocalJsonFiles.includes(x.jsonName)
        if (!found) {
          throw new Error('Schema file name must be present in the catalog URL. (see: src/api/json/catalog.json)=> ' + x.jsonName)
        }
      }
    }
    // Get all the json file for AJV and tv4
    localSchemaFileAndTestFile({ schema_1_PassScan: schemaFileCompare }, { fullScanAllFiles: true })
    grunt.log.ok('All local schema files have URL link in catalog. Total:' + countScan)
  })

  grunt.registerTask('local_catalog-fileMatch-conflict', 'note: app.json and *app.json conflicting will not be detected', function () {
    const fileMatchConflict = schemaValidation.fileMatchConflict
    let fileMatchCollection = []
    // Collect all the "fileMatch" and put it in fileMatchCollection[]
    for (const schema of catalog.schemas) {
      const fileMatchArray = schema.fileMatch
      if (fileMatchArray) {
        // Check if this is already present in the "fileMatchConflict" list. If so then remove it from filtered[]
        const filtered = fileMatchArray.filter(fileMatch => {
          return !fileMatchConflict.includes(fileMatch)
        })
        // Check if fileMatch is already present in the fileMatchCollection[]
        filtered.forEach(fileMatch => {
          if (fileMatchCollection.includes(fileMatch)) {
            throw new Error('Duplicate fileMatch found => ' + fileMatch)
          }
        })
        fileMatchCollection = fileMatchCollection.concat(filtered)
      }
    }
    grunt.log.ok('No new fileMatch conflict detected.')
  })

  grunt.registerTask('local_filename_with_json_extension', 'Dynamically check local schema/test file for filename extension', function () {
    let countScan = 0
    const x = (data) => {
      countScan++
      if (!data.jsonName.endsWith('.json')) {
        throw new Error('Filename must have .json extension => ' + data.urlOrFilePath)
      }
    }
    localSchemaFileAndTestFile(
      {
        schema_1_PassScan: x,
        positiveTest_1_PassScan: x,
        negativeTest_1_PassScan: x
      }, {
        fullScanAllFiles: true,
        logTestFolder: false
      })
    grunt.log.ok('All schema and test filename have .json extension. Total files scan: ' + countScan)
  })

  grunt.registerTask('local_search_for_schema_without_positive_test_files', 'Dynamically check local schema if positive test files are present', function () {
    let countMissingTest = 0
    // Check if each schemasToBeTested[] items is present in foldersPositiveTest[]
    schemasToBeTested.forEach(schemaFileName => {
      if (!foldersPositiveTest.includes(schemaFileName.replace('.json', ''))) {
        countMissingTest++
        grunt.log.ok('(No positive test file present): ' + schemaFileName)
      }
    })
    if (countMissingTest > 0) {
      const percent = (countMissingTest / schemasToBeTested.length) * 100
      grunt.log.writeln()
      grunt.log.writeln(`${Math.round(percent)}% of schemas do not have tests.`)
      grunt.log.ok('Schemas that have no positive test files. Total files: ' + countMissingTest)
    } else {
      grunt.log.ok('All schemas have positive test')
    }
  })

  grunt.registerTask('local_validate_directory_structure', 'Dynamically check if schema and test directory structure are valid', function () {
    schemasToBeTested.forEach((name) => {
      if (!skipThisFileName(name) && !fs.lstatSync(pt.join(schemaDir, name)).isFile()) {
        throw new Error('There can only be files in directory :' + schemaDir + ' => ' + name)
      }
    })

    foldersPositiveTest.forEach((name) => {
      if (!skipThisFileName(name) && !fs.lstatSync(pt.join(testPositiveDir, name)).isDirectory()) {
        throw new Error("There can only be directory's in :" + testPositiveDir + ' => ' + name)
      }
    })

    foldersNegativeTest.forEach((name) => {
      if (!skipThisFileName(name) && !fs.lstatSync(pt.join(testNegativeDir, name)).isDirectory()) {
        throw new Error("There can only be directory's in :" + testNegativeDir + ' => ' + name)
      }
    })
    grunt.log.ok('OK')
  })

  grunt.registerTask('local_test_downgrade_schema_version', 'Dynamically check local schema version is not to high', function () {
    const countSchemas = countSchemasType
    let countScan = 0
    let option

    const validateViaAjv = (schemaJson, schemaName, option) => {
      try {
        const ajvSelected = factoryAJV(schemaName, option.unknownFormatsList)

        // AJV must ignore these keywords
        option.unknownKeywordsList?.forEach((x) => {
          ajvSelected.addKeyword(x)
        })

        // Add external schema to AJV
        option.externalSchemaWithPathList.forEach((x) => {
          ajvSelected.addSchema(require(x.toString()))
        })

        ajvSelected.compile(schemaJson)
        return true
      } catch (e) {
        return false
      }
    }

    // There are no positive or negative test processes here.
    // Only the schema files are tested.
    const testLowerSchemaVersion = (callbackParameter) => {
      countScan++
      let versionIndexOriginal = 0
      let schemaVersionToBeTested = countSchemas[versionIndexOriginal]
      const schemaJson = JSON.parse(callbackParameter.rawFile)

      if (!('$schema' in schemaJson)) {
        // There is no $schema present in the file.
        return
      }

      option = getOption(callbackParameter.jsonName)

      // get the present schema_version
      const schemaVersion = schemaJson.$schema
      for (const [index, value] of countSchemas.entries()) {
        if (schemaVersion.includes(value.schemaStr)) {
          versionIndexOriginal = index
          break
        }
      }

      // start testing each schema version in a while loop.
      let result = false
      let recommendedIndex = versionIndexOriginal
      let versionIndexToBeTested = versionIndexOriginal
      do {
        // keep trying to use the next lower schema version from the countSchemas[]
        versionIndexToBeTested++
        schemaVersionToBeTested = countSchemas[versionIndexToBeTested]
        if (!schemaVersionToBeTested.active) {
          // Can not use this schema version. And there are no more 'active' list item left.
          break
        }

        if (schemaVersionToBeTested.schemaName === 'draft-06') {
          // Not interested in downgrading to "draft-06". Skip this one.
          result = true
          continue
        }

        // update the schema with a new alternative $schema version
        schemaJson.$schema = `http://${schemaVersionToBeTested.schemaStr}`
        // Test this new updated schema with AJV
        result = validateViaAjv(schemaJson, schemaVersionToBeTested.schemaName, option)

        if (result) {
          // It passes the test. So this is the new recommended index
          recommendedIndex = versionIndexToBeTested
        }
        // keep in the loop till it fail the validation process.
      } while (result)

      if (recommendedIndex !== versionIndexOriginal) {
        // found a different schema version that also work.
        const original = countSchemas[versionIndexOriginal].schemaName
        const recommended = countSchemas[recommendedIndex].schemaName
        grunt.log.ok(`${callbackParameter.jsonName} (${original}) is also valid with (${recommended})`)
      }
    }

    grunt.log.writeln()
    grunt.log.ok('Check if a lower $schema version will also pass the schema validation test')
    localSchemaFileAndTestFile({ schema_1_PassScan: testLowerSchemaVersion })
    grunt.log.writeln()
    grunt.log.ok(`Total files scan: ${countScan}`)
  })

  function showSchemaVersions () {
    const countSchemas = countSchemasType
    let countSchemaVersionUnknown = 0

    const getObj_ = (schemaJson) => {
      if ('$schema' in schemaJson) {
        const schemaVersion = schemaJson.$schema
        for (const obj of countSchemas) {
          if (schemaVersion.includes(obj.schemaStr)) {
            return obj
          }
        }
      }
      // Can not find the $schema version.
      return undefined
    }

    return {
      getObj: getObj_,
      process_data: (callbackParameter) => {
        let obj
        try {
          obj = getObj_(JSON.parse(callbackParameter.rawFile))
        } catch (e) {
          // suppress possible JSON.parse exception. It will be processed as obj = undefined
        }
        if (obj) {
          obj.totalCount++
        } else {
          countSchemaVersionUnknown++
          grunt.log.error(`$schema is unknown in the file: ${callbackParameter.urlOrFilePath}`)
        }
      },
      process_data_done: () => {
        // Show the all the schema version count.
        for (const obj of countSchemas) {
          grunt.log.ok(`Schemas using (${obj.schemaName}) Total files: ${obj.totalCount}`)
        }
        grunt.log.ok(`$schema unknown. Total files: ${countSchemaVersionUnknown}`)
      }
    }
  }

  grunt.registerTask('local_count_schema_versions', 'Dynamically check local schema for schema version count', function () {
    const x = showSchemaVersions()
    localSchemaFileAndTestFile({
      schema_1_PassScan: x.process_data,
      schema_1_PassScanDone: x.process_data_done
    },
    {
      fullScanAllFiles: true
    })
  })

  grunt.registerTask('remote_count_schema_versions', 'Dynamically load remote schema file for schema version count', async function () {
    const done = this.async()
    const x = showSchemaVersions()
    await remoteSchemaFile((callbackParameter) => { x.process_data(callbackParameter) }, false)
    x.process_data_done()
    done()
  })

  grunt.registerTask('local_check_for_schema_version_present', 'Dynamically load schema file for $schema present check', function () {
    let countScan = 0
    localSchemaFileAndTestFile({
      schema_1_PassScan: function (callbackParameter) {
        countScan++
        let schemaJson
        try {
          schemaJson = JSON.parse(callbackParameter.rawFile)
        } catch (err) {
          throw new Error(`Schema file ${callbackParameter.jsonName} at did not parse correctly: ${err}`)
        }
        if (!('$schema' in schemaJson)) {
          throw new Error("Schema file is missing '$schema' keyword => " + callbackParameter.jsonName)
        }
      }
    },
    {
      fullScanAllFiles: true
    })
    grunt.log.writeln()
    grunt.log.ok(`Total files scan: ${countScan}`)
  })

  grunt.registerTask('local_check_duplicate_list_in_schema-validation.json', 'Check if options list is unique in schema-validation.json', function () {
    function checkForDuplicateInList (list, listName) {
      if (list) {
        if (new Set(list).size !== list.length) {
          throw new Error('Duplicate item found in ' + listName)
        }
      }
    }
    checkForDuplicateInList(schemaValidation.tv4test, 'tv4test[]')
    checkForDuplicateInList(schemaValidation.skiptest, 'skiptest[]')
    checkForDuplicateInList(schemaValidation.missingcatalogurl, 'missingcatalogurl[]')
    checkForDuplicateInList(schemaValidation.fileMatchConflict, 'fileMatchConflict[]')

    // Check for duplicate in options[]
    const checkList = []
    for (const item of schemaValidation.options) {
      const schemaName = Object.keys(item).pop()
      if (checkList.includes(schemaName)) {
        throw new Error('Duplicate schema name found in options[] schema-validation.json => ' + schemaName)
      }
      // Check for all values inside one option object
      const optionValues = Object.values(item).pop()
      checkForDuplicateInList(optionValues?.unknownKeywords, schemaName + ' unknownKeywords[]')
      checkForDuplicateInList(optionValues?.unknownFormat, schemaName + ' unknownFormat[]')
      checkForDuplicateInList(optionValues?.externalSchema, schemaName + ' externalSchema[]')
      checkList.push(schemaName)
    }

    grunt.log.ok('OK')
  })

  function hasBOM (buf) {
    return buf.length > 2 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  }

  function parseJSON (text) {
    try {
      return {
        json: JSON.parse(text)
      }
    } catch (err) {
      return {
        error: err.message
      }
    }
  }

  const rawGithubPrefix = 'https://raw.githubusercontent.com/'

  function isRawGithubURL (url) {
    return url.startsWith(rawGithubPrefix)
  }

  // extract repo, branch and path from a raw GitHub url
  // returns false if not a raw GitHub url
  function parseRawGithubURL (url) {
    if (isRawGithubURL(url)) {
      const [project, repo, branch, ...path] =
        url
          .substr(rawGithubPrefix.length)
          .split('/')
      return {
        repo: `https://github.com/${project}/${repo}`,
        base: `${project}/${repo}`,
        branch,
        path: path.join('/')
      }
    }
    return false
  }

  const util = require('util')
  const exec = util.promisify(require('child_process').exec)

  // heuristic to find valid version tag
  // disregard versions that are marked as special
  // require at least a number
  function validVersion (version) {
    const invalid =
      /alpha|beta|next|rc|tag|pre|\^/i.test(version) ||
      !/\d+/.test(version)
    return !invalid
  }

  // extract tags that might represent versions and return most recent
  // returns false none found
  async function githubNewestRelease (githubRepo) {
    const cmd = `git ls-remote --tags ${githubRepo}`

    const result = await exec(cmd)
    const stdout = result.stdout.trim()
    if (stdout === '') {
      return false
    }
    const refs =
      stdout
        .split('\n')
        .map(line =>
          line
            .split('\t')[1]
            .split('/')[2]
        )

    // sort refs using "natural" ordering (so that it works with versions)
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: 'base'
    })
    refs.sort(collator.compare)
    const refsDescending =
      refs
        .reverse()
        .filter(version => validVersion(version))
    if (refsDescending.length > 0) {
      return refsDescending[0]
    }
    return false
  }

  // git default branch (master/main)
  async function githubDefaultBranch (githubRepo) {
    const cmd = `git ls-remote --symref ${githubRepo} HEAD`
    const prefix = 'ref: refs/heads/'

    const result = await exec(cmd)
    const stdout = result.stdout.trim()
    const rows =
      stdout
        .split('\n')
        .map(line => line.split('\t'))
    for (const row of rows) {
      if (row[0].startsWith(prefix)) {
        return row[0].substr(prefix.length)
      }
    }
    throw new Error('unable to determine default branch')
  }

  // construct raw GitHub url to the newest version
  async function rawGithubVersionedURL (url) {
    const urlParts = parseRawGithubURL(url)
    let branch = await githubNewestRelease(urlParts.repo)
    if (branch === false) {
      branch = await githubDefaultBranch(urlParts.repo)
    }
    return {
      repo: urlParts.repo,
      branch,
      rawURL: `${rawGithubPrefix}${urlParts.base}/${branch}/${urlParts.path}`
    }
  }

  // Async task structure: https://gruntjs.com/creating-tasks
  grunt.registerTask('validate_links', 'Check if links return 200 and valid json', async function () {
    // Force task into async mode and grab a handle to the "done" function.
    const done = this.async()

    const catalogFileName = 'api/json/catalog.json'
    const catalog = grunt.file.readJSON(catalogFileName)
    const got = require('got')

    for (let { url } of catalog.schemas) {
      if (isRawGithubURL(url)) {
        const { repo, branch, rawURL } = await rawGithubVersionedURL(url)
        if (url !== rawURL) {
          grunt.log.error('repo', repo, 'branch', branch, 'url should be', rawURL)
          // test if the advised url works
          url = rawURL
        }
      }

      try {
        const body = await got(url)
        if (body.statusCode !== 200) {
          grunt.log.error(url, body.statusCode)
          continue
        }
        if (hasBOM(body.rawBody)) {
          grunt.log.error(url, 'contains UTF-8 BOM')
        }
        const result = parseJSON(body.rawBody.toString('utf8'))
        if (result.error) {
          grunt.log.error(url, result.error)
        }
      } catch (err) {
        grunt.log.error(url, err.message)
      }
    }

    done()
  })

  grunt.registerTask('local_test',
    [
      'local_check_duplicate_list_in_schema-validation.json',
      'local_validate_directory_structure',
      'local_filename_with_json_extension',
      'local_catalog',
      'local_catalog-fileMatch-conflict',
      'local_url-present-in-catalog',
      'local_schema-present-in-catalog-list',
      'local_bom',
      'local_find-duplicated-property-keys',
      'local_check_for_schema_version_present',
      'local_count_schema_versions',
      'local_search_for_schema_without_positive_test_files',
      'local_tv4_only_for_non_compliance_schema',
      'tv4',
      'local_ajv_test'
    ])
  grunt.registerTask('remote_test', ['remote_count_schema_versions', 'remote_bom', 'remote_ajv_test'])
  grunt.registerTask('default', ['local_test'])
  grunt.registerTask('local_maintenance', ['local_test_downgrade_schema_version'])

  grunt.loadNpmTasks('grunt-tv4')
}
