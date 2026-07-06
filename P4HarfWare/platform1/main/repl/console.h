/*
 * console.h — Serial console commands
 */
#ifndef CONSOLE_H
#define CONSOLE_H

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Register all console commands and start the REPL.
 */
void console_init(void);

#ifdef __cplusplus
}
#endif

#endif // CONSOLE_H
