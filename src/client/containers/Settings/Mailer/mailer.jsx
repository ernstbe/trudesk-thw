/*
 *       .                             .o8                     oooo
 *    .o8                             "888                     `888
 *  .o888oo oooo d8b oooo  oooo   .oooo888   .ooooo.   .oooo.o  888  oooo
 *    888   `888""8P `888  `888  d88' `888  d88' `88b d88(  "8  888 .8P'
 *    888    888      888   888  888   888  888ooo888 `"Y88b.   888888.
 *    888 .  888      888   888  888   888  888    .o o.  )88b  888 `88b.
 *    "888" d888b     `V88V"V8P' `Y8bod88P" `Y8bod8P' 8""888P' o888o o888o
 *  ========================================================================
 *  Author:     Chris Brame
 *  Updated:    2/7/19 1:36 AM
 *  Copyright (c) 2014-2019. All rights reserved.
 */

import React, { useCallback } from 'react'
import PropTypes from 'prop-types'
import axios from 'axios'
import Log from '../../../logger'
import { connect } from 'react-redux'
import { withTranslation } from 'react-i18next'
import helpers from 'lib/helpers'

import Button from 'components/Button'
import SettingItem from 'components/Settings/SettingItem'

// Outgoing mail is configured only through SMTP_* in the server environment
// (see src/mailer). This page shows what is in effect and tests it.
const MailerSettingsMailer = ({ settings, t }) => {
  const getSetting = useCallback(
    name => {
      const value = settings.getIn(['settings', name, 'value'])
      return value === undefined || value === null ? '' : value
    },
    [settings]
  )

  const enabled = !!getSetting('mailerEnabled')

  const testMailerSettings = useCallback(
    e => {
      e.preventDefault()
      helpers.UI.showSnackbar(t('settings.testing'))

      axios
        .post('/api/v1/settings/testmailer', {})
        .then(() => {
          helpers.UI.showSnackbar(t('settings.successfullyConnected'))
        })
        .catch(err => {
          if (!err.response) return Log.error(err)
          helpers.UI.showSnackbar(t('settings.connectionFailed'), true)
          Log.error(err.response.data.error, err.response)
        })
    },
    [t]
  )

  const rows = [
    [t('settings.mailServer'), `${getSetting('mailerHost')}:${getSetting('mailerPort')} (${getSetting('mailerSSL') ? 'SSL/TLS' : 'STARTTLS'})`],
    [t('settings.authUsername'), getSetting('mailerUsername')],
    [t('settings.fromAddress'), getSetting('mailerFrom')]
  ]

  return (
    <SettingItem
      title={t('settings.mailerTitle')}
      subtitle={t('settings.mailerHint')}
      component={
        <span className={enabled ? 'uk-text-success' : 'uk-text-muted'} style={{ lineHeight: '36px' }}>
          {t(enabled ? 'settings.enabled' : 'settings.mailerNotConfiguredShort')}
        </span>
      }
    >
      {enabled
        ? (
          <div>
            <table className='uk-table uk-table-condensed uk-margin-small-bottom'>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td className='uk-text-muted' style={{ width: '200px' }}>{label}</td>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className='uk-text-muted uk-margin-medium-bottom'>{t('settings.mailerEnvManaged')}</p>
            <div className='uk-clearfix'>
              <Button
                text={t('settings.testSettings')}
                type='button'
                flat
                waves
                style='primary'
                extraClass='uk-float-left'
                onClick={e => testMailerSettings(e)}
              />
            </div>
          </div>
          )
        : (
          <p className='uk-text-muted'>{t('settings.mailerNotConfigured')}</p>
          )}
    </SettingItem>
  )
}

MailerSettingsMailer.propTypes = {
  settings: PropTypes.object.isRequired,
  t: PropTypes.func.isRequired
}

const mapStateToProps = state => ({
  settings: state.settings.settings
})

export default withTranslation()(connect(mapStateToProps)(MailerSettingsMailer))
