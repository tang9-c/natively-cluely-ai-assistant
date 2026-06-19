/**
 * ModesSettings — official local implementation.
 *
 * Keep this entrypoint wired directly to ModesSettingsBase so the settings
 * panel cannot be silently replaced by an optional external directory.
 */
export { ModesSettingsBase as default } from './ModesSettingsBase';
