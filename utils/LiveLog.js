export function dispatchLiveLog(message, alertCard) {
	if (!message || message.type !== 'log') return false;
	alertCard.addAlert(message.data);
	return true;
}
