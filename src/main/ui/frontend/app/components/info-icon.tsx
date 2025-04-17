import 'react';
import { dispatchRcConfigModalOpen } from './rc-config-modal.js';
import { ToggleButton } from './toggle-button.js';

export const InfoIcon = () => {
  return <ToggleButton onClick={dispatchRcConfigModalOpen}>ℹ️</ToggleButton>;
};
